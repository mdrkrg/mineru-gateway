"""OAuth / OIDC routes: authorize, callback (Section 5.1).

Spec: user-management-and-oauth.md Section 4.5.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi_users import exceptions as fu_exceptions
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...config import Settings
from ...models import OAuthAccount, User
from ..backend import issue_token_pair
from ..dependencies import get_session, get_settings_dep
from ..manager import UserManager
from ..schemas import TokenPair
from . import base

router = APIRouter(prefix="/auth/oauth", tags=["oauth"])

_COOKIE_NAME = "gateway_oauth_state"


def _resolve_display_name(profile: dict) -> str:
    """Section 4.5: display_name fallback chain."""
    for key in ("name", "preferred_username", "given_name"):
        val = profile.get(key)
        if val:
            return val
    email = profile.get("email", "")
    return email.split("@")[0] if email else ""


def _get_redirect_base_url(settings: Settings) -> str:
    return settings.oauth_redirect_base_url or settings.gateway_url


def _is_secure(settings: Settings) -> bool:
    """Section 7.2: cookie secure flag depends on environment."""
    base_url = _get_redirect_base_url(settings)
    return base_url.startswith("https://")


def _sign_state(state: str, settings: Settings) -> str:
    """Section 4.5/7.2: sign state with HMAC-SHA256 using jwt_secret.

    Returns ``"{state}.{hmac_hexdigest}"`` so the cookie value is
    tamper-proof while keeping the state itself readable.
    """
    key = settings.jwt_secret.encode("utf-8")
    msg = state.encode("utf-8")
    sig = hmac.new(key, msg, hashlib.sha256).hexdigest()
    return f"{state}.{sig}"


def _extract_state_from_cookie(
    cookie_value: str | None, settings: Settings
) -> str | None:
    """Section 4.5/7.2: verify HMAC signature and return the state.

    Returns the original state if the signature is valid, or ``None``
    if the cookie is missing, malformed, or the signature does not match.
    """
    if not cookie_value or "." not in cookie_value:
        return None
    state, _, sig = cookie_value.rpartition(".")
    if not state or not sig:
        return None
    expected = _sign_state(state, settings)
    if hmac.compare_digest(expected, cookie_value):
        return state
    return None


def _coerce_email_verified(value) -> bool | None:
    """Section 4.5: extract boolean from email_verified claim.

    Some providers return "true"/"false" strings or 1/0.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.lower() == "true"
    return None


async def _get_user_manager(
    session: AsyncSession, settings: Settings
) -> tuple[SQLAlchemyUserDatabase, UserManager]:
    user_db = SQLAlchemyUserDatabase(session, User, OAuthAccount)
    return user_db, UserManager(user_db, settings)


@router.get("/{provider}/authorize")
async def authorize(
    provider: str,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings_dep),
) -> Response:
    """Section 4.5: 302 redirect to OIDC provider + set CSRF state cookie."""
    client = base.get_oauth_client(provider)
    if client is None:
        raise HTTPException(status_code=404, detail="Unknown OAuth provider")

    state = secrets.token_urlsafe(32)
    redirect_uri = f"{_get_redirect_base_url(settings)}/auth/oauth/{provider}/callback"
    auth_url = await client.get_authorization_url(redirect_uri, state)

    response.set_cookie(
        key=_COOKIE_NAME,
        value=_sign_state(state, settings),
        httponly=True,
        samesite="lax",
        secure=_is_secure(settings),
        max_age=600,
    )
    response.status_code = status.HTTP_302_FOUND
    response.headers["location"] = auth_url
    return response


@router.get("/{provider}/callback", response_model=None)
async def callback(
    provider: str,
    request: Request,
    code: str,
    state: str,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
):
    """Section 4.5: exchange code, upsert User + OAuthAccount, issue tokens."""
    client = base.get_oauth_client(provider)
    if client is None:
        raise HTTPException(status_code=404, detail="Unknown OAuth provider")

    # Step 1: Verify CSRF state (cookie is HMAC-signed)
    cookie_state = _extract_state_from_cookie(
        request.cookies.get(_COOKIE_NAME), settings
    )
    if not cookie_state or not secrets.compare_digest(cookie_state, state):
        raise HTTPException(status_code=400, detail="State mismatch (CSRF)")

    redirect_uri = f"{_get_redirect_base_url(settings)}/auth/oauth/{provider}/callback"

    # Step 2: Exchange code for access_token
    try:
        token_data = await client.get_access_token(code, redirect_uri)
    except Exception:
        raise HTTPException(status_code=400, detail="Code exchange failed")

    oidc_access_token = (
        token_data.get("access_token")
        if isinstance(token_data, dict)
        else getattr(token_data, "access_token", None)
    )

    # Step 3: Get user profile
    profile = await client.get_profile(oidc_access_token)
    sub = profile.get("sub")
    email = profile.get("email", "")
    display_name = _resolve_display_name(profile)
    email_verified = _coerce_email_verified(profile.get("email_verified"))

    if not sub or not email:
        raise HTTPException(status_code=400, detail="OIDC profile missing sub or email")

    _, user_manager = await _get_user_manager(session, settings)

    # Prepare response to clear CSRF cookie (Section 7.2: single-use)
    response = Response()

    # Step 4: Lookup existing OAuthAccount by (oauth_name, account_id)
    existing_oauth = (
        await session.execute(
            select(OAuthAccount).where(
                OAuthAccount.oauth_name == provider,
                OAuthAccount.account_id == sub,
            )
        )
    ).scalar_one_or_none()

    if existing_oauth is not None:
        # Existing OAuthAccount -> update tokens, use existing User
        existing_oauth.access_token = oidc_access_token or ""
        refresh = (
            token_data.get("refresh_token")
            if isinstance(token_data, dict)
            else getattr(token_data, "refresh_token", None)
        )
        existing_oauth.refresh_token = refresh or ""
        expires_at = (
            token_data.get("expires_at")
            if isinstance(token_data, dict)
            else getattr(token_data, "expires_at", None)
        )
        existing_oauth.expires_at = expires_at
        existing_oauth.account_email = email
        await session.commit()
        user = await session.get(User, existing_oauth.user_id)
        if not user.is_active:
            raise HTTPException(status_code=400, detail="User is inactive")
    else:
        # No existing OAuthAccount -> lookup User by email
        try:
            existing_user = await user_manager.get_by_email(email)
        except fu_exceptions.UserNotExists:
            existing_user = None

        if existing_user is not None:
            # Email exists -> check email_verified
            if email_verified is True:
                if not existing_user.is_active:
                    raise HTTPException(status_code=400, detail="User is inactive")
                user = existing_user
            elif email_verified is False:
                raise HTTPException(
                    status_code=409,
                    detail="Email exists but not verified by provider",
                )
            else:
                raise HTTPException(
                    status_code=400,
                    detail="Email exists but email_verified claim missing",
                )
        else:
            # Create new User
            is_verified = bool(email_verified)
            random_pw = user_manager.password_helper.generate()
            user = User(
                email=email,
                display_name=display_name,
                is_active=True,
                is_superuser=False,
                is_verified=is_verified,
                hashed_password=user_manager.password_helper.hash(random_pw),
            )
            await user_manager.on_after_register(user, request=request)
            session.add(user)
            await session.flush()

        # Step 5: Create OAuthAccount
        refresh = (
            token_data.get("refresh_token")
            if isinstance(token_data, dict)
            else getattr(token_data, "refresh_token", None)
        )
        expires_at = (
            token_data.get("expires_at")
            if isinstance(token_data, dict)
            else getattr(token_data, "expires_at", None)
        )
        oauth_account = OAuthAccount(
            user_id=user.id,
            oauth_name=provider,
            access_token=oidc_access_token or "",
            refresh_token=refresh or "",
            expires_at=expires_at,
            account_id=sub,
            account_email=email,
        )
        session.add(oauth_account)
        await session.commit()
        await session.refresh(user)

    # Step 6: Issue token pair
    tokens = await issue_token_pair(user, settings)
    await user_manager.on_after_login(user, request=request, response=response)

    # Step 7: Return JSON or redirect to frontend
    response.delete_cookie(_COOKIE_NAME)

    if settings.oauth_frontend_redirect_url:
        fragment_params = urlencode(
            {
                "access_token": tokens["access_token"],
                "refresh_token": tokens["refresh_token"],
                "token_type": tokens["token_type"],
            }
        )
        redirect_url = f"{settings.oauth_frontend_redirect_url}#{fragment_params}"
        response.status_code = status.HTTP_302_FOUND
        response.headers["location"] = redirect_url
        return response

    response.media_type = "application/json"
    response.body = TokenPair(**tokens).model_dump_json().encode()
    return response
