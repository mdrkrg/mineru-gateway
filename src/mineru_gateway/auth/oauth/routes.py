"""OAuth / OIDC routes: authorize, callback (Section 5.1).

Spec: user-management-and-oauth.md Section 4.5.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json as jsonlib
import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from starlette.responses import JSONResponse, RedirectResponse
from fastapi_users import exceptions as fu_exceptions
from fastapi_users.db import SQLAlchemyUserDatabase
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...config import OIDCProviderConfig, Settings
from ...models import OAuthAccount, User
from ..backend import issue_token_pair
from ..dependencies import get_session, get_settings_dep
from ..manager import UserManager
from ..schemas import TokenPair
from . import base

router = APIRouter(prefix="/auth/oauth", tags=["oauth"])


class OAuthProviderInfo(BaseModel):
    """Section 4.5: minimal OAuth provider info for frontend discovery."""

    name: str


class OAuthProvidersResponse(BaseModel):
    """Section 4.5: list of configured OIDC provider names (secrets excluded)."""

    providers: list[OAuthProviderInfo]


_COOKIE_NAME = "gateway_oauth_state"


def _get_provider_config(
    provider: str, settings: Settings
) -> OIDCProviderConfig | None:
    """Lookup provider config by name."""
    for p in settings.oidc_providers:
        if p.name == provider:
            return p
    return None


def _decode_id_token(id_token: str) -> dict:
    """Section 4.5 step 3a: base64-decode JWT payload without signature
    verification."""
    parts = id_token.split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1]
    padded = payload + "=" * (4 - len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded)
    except Exception:
        return {}
    try:
        return jsonlib.loads(decoded)
    except Exception:
        return {}


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


def _get_redirect_base_url(settings: Settings) -> str:
    """Public callback base URL, without a trailing slash.

    A trailing slash in the configured base would produce
    ``//auth/oauth/{provider}/callback`` callback URLs that no longer match
    the redirect URI registered with the OIDC provider.
    """
    return (settings.oauth_redirect_base_url or settings.gateway_url).rstrip("/")


def _is_secure(settings: Settings) -> bool:
    """Section 7.2: cookie secure flag depends on environment."""
    base_url = _get_redirect_base_url(settings)
    return base_url.startswith("https://")


def _sign_state(state: str, settings: Settings) -> str:
    """Section 4.5/7.2: sign the state payload with HMAC-SHA256.

    Returns ``"{payload}.{hmac_hexdigest}"`` so the cookie value is
    tamper-proof while keeping the payload readable. The payload is
    provider-qualified (``"{provider}:{state}"``) so a state issued for one
    provider cannot complete another provider's callback.
    """
    key = settings.jwt_secret.encode("utf-8")
    msg = state.encode("utf-8")
    sig = hmac.new(key, msg, hashlib.sha256).hexdigest()
    return f"{state}.{sig}"


def _extract_state_from_cookie(
    cookie_value: str | None, settings: Settings
) -> str | None:
    """Section 4.5/7.2: verify HMAC signature and return the payload.

    Returns the signed payload (``"{provider}:{state}"``) if the signature
    is valid, or ``None`` if the cookie is missing, malformed, or the
    signature does not match.
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


async def _get_user_manager(
    session: AsyncSession, settings: Settings
) -> tuple[SQLAlchemyUserDatabase, UserManager]:
    user_db = SQLAlchemyUserDatabase(session, User, OAuthAccount)
    return user_db, UserManager(user_db, settings)


@router.get("/providers", response_model=OAuthProvidersResponse)
async def providers(
    settings: Settings = Depends(get_settings_dep),
) -> OAuthProvidersResponse:
    """Section 4.5: list configured OIDC provider names (secrets excluded)."""
    return OAuthProvidersResponse(
        providers=[OAuthProviderInfo(name=p.name) for p in settings.oidc_providers]
    )


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
        value=_sign_state(f"{provider}:{state}", settings),
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

    prov_cfg = _get_provider_config(provider, settings)
    mapping = prov_cfg.user_info_mapping if prov_cfg else {}
    email_fallback_domain = prov_cfg.email_fallback_domain if prov_cfg else None

    # Step 1: Verify CSRF state (cookie is HMAC-signed and provider-bound)
    cookie_payload = _extract_state_from_cookie(
        request.cookies.get(_COOKIE_NAME), settings
    )
    expected_payload = f"{provider}:{state}"
    if not cookie_payload or not secrets.compare_digest(
        cookie_payload, expected_payload
    ):
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

    # Step 3: Claim fallback chain (Section 4.5 step 3a-3g)

    # 3a: Decode id_token if present
    raw_id_token = (
        token_data.get("id_token")
        if isinstance(token_data, dict)
        else getattr(token_data, "id_token", None)
    )
    id_token_claims = _decode_id_token(raw_id_token) if raw_id_token else {}

    # 3b: Call userinfo if configured
    userinfo_claims = {}
    if oidc_access_token:
        try:
            userinfo_claims = await client.get_profile(oidc_access_token)
        except Exception:
            raise HTTPException(status_code=400, detail="Userinfo request failed")

    # 3c: Merge, userinfo overrides id_token
    claims = {**id_token_claims, **userinfo_claims}

    # 3d: Apply user_info_mapping
    display_name_claim = mapping.get("display_name", "name")
    email_claim = mapping.get("email", "email")
    raw_display_name = claims.get(display_name_claim, "")
    raw_email = claims.get(email_claim, "")

    # 3e: display_name fallback chain
    display_name = raw_display_name
    if not display_name:
        for key in ("preferred_username", "name"):
            val = claims.get(key, "")
            if val:
                display_name = val
                break
    if not display_name:
        display_name = raw_email.split("@")[0] if raw_email else ""

    # 3f: email fallback chain
    email = raw_email
    sub = id_token_claims.get("sub") or userinfo_claims.get("sub") or ""
    if not email:
        if email_fallback_domain:
            email = f"{sub}@{email_fallback_domain}"
            if not display_name:
                display_name = sub
        else:
            raise HTTPException(status_code=400, detail="OIDC profile missing email")

    # 3g: email_verified (fixed mapping, not affected by user_info_mapping)
    email_verified = _coerce_email_verified(claims.get("email_verified"))

    # 3h: trusted domain exception (spec: user-management-and-oauth.md
    # Section 4.5 step 3h): an email whose domain (case-insensitive) is
    # listed in the provider's trusted_email_domains is treated as
    # verified even when the claim is missing or false.
    if email_verified is not True and prov_cfg is not None:
        trusted_domains = {d.lower() for d in prov_cfg.trusted_email_domains}
        if trusted_domains and email.rsplit("@", 1)[-1].lower() in trusted_domains:
            email_verified = True

    if not sub:
        raise HTTPException(status_code=400, detail="OIDC profile missing sub")

    _, user_manager = await _get_user_manager(session, settings)

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
    await user_manager.on_after_login(user, request=request, response=None)

    # Step 7: Return JSON or redirect to frontend
    # Clear CSRF cookie (Section 7.2: single-use)
    cookie_jar = Response()
    cookie_jar.delete_cookie(_COOKIE_NAME)
    set_cookie_header = cookie_jar.headers.get("set-cookie", "")

    if settings.oauth_frontend_redirect_url:
        fragment_params = urlencode(
            {
                "access_token": tokens["access_token"],
                "refresh_token": tokens["refresh_token"],
                "token_type": tokens["token_type"],
            }
        )
        redirect_url = f"{settings.oauth_frontend_redirect_url}#{fragment_params}"
        resp = RedirectResponse(redirect_url, status_code=status.HTTP_302_FOUND)
        if set_cookie_header:
            resp.headers["set-cookie"] = set_cookie_header
        return resp

    resp = JSONResponse(
        content=TokenPair(**tokens).model_dump(),
        media_type="application/json",
    )
    if set_cookie_header:
        resp.headers["set-cookie"] = set_cookie_header
    return resp
