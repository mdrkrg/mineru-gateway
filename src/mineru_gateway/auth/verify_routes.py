"""Email-link verification endpoint (spec: email-verification.md Section 4.3).

GET /auth/verify?token= performs the same verification as the fastapi-users
POST /auth/verify route, but is usable directly from a link inside the
verification email (browsers cannot easily issue POSTs).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi_users import exceptions
from fastapi_users.jwt import decode_jwt
from jwt import PyJWTError
from starlette.responses import RedirectResponse

from ..config import Settings
from ..models import User
from .dependencies import get_settings_dep
from .manager import UserManager, get_user_manager
from .schemas import UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/verify", response_model=UserRead)
async def verify_via_email_link(
    token: str,
    request: Request,
    user_manager: Annotated[UserManager, Depends(get_user_manager)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> UserRead | RedirectResponse:
    """Section 4.3: verify a user from the email link token.

    - Success: 200 + UserRead, or 302 to
      ``{oauth_frontend_redirect_url}#verified=true`` when the frontend
      redirect URL is configured. An already-verified user is idempotent
      success: email clients / scanners prefetch links and consume the
      single-use token, so a later genuine click still means the goal
      state (is_verified=true) is achieved.
    - Failure (invalid / expired / mismatched token, or the token's user
      can no longer be resolved): 400, or 302 to
      ``{oauth_frontend_redirect_url}#verified=false``.
    """
    redirect_url = settings.oauth_frontend_redirect_url
    try:
        user = await user_manager.verify(token, request)
    except exceptions.UserAlreadyVerified:
        user = await _verified_user_from_token(user_manager, token)
        if user is None:
            return _failure(redirect_url)
        return _success(redirect_url, user)
    except exceptions.InvalidVerifyToken:
        return _failure(redirect_url)
    return _success(redirect_url, user)


async def _verified_user_from_token(
    user_manager: UserManager, token: str
) -> User | None:
    """Re-resolve the verified user behind an already-consumed token.

    fastapi-users raises UserAlreadyVerified only after decoding the token
    and resolving the user, so recovery mirrors those claims; any failure
    falls back to the failure response via None.
    """
    try:
        data = decode_jwt(
            token,
            user_manager.verification_token_secret,
            [user_manager.verification_token_audience],
        )
        user = await user_manager.get_by_email(data["email"])
    except PyJWTError, KeyError, exceptions.UserNotExists:
        return None
    if user is None or not user.is_verified:
        return None
    return user


def _success(redirect_url: str, user: User) -> UserRead | RedirectResponse:
    if redirect_url:
        return RedirectResponse(
            f"{redirect_url}#verified=true",
            status_code=status.HTTP_302_FOUND,
        )
    return UserRead.model_validate(user)


def _failure(redirect_url: str) -> UserRead | RedirectResponse:
    if redirect_url:
        return RedirectResponse(
            f"{redirect_url}#verified=false",
            status_code=status.HTTP_302_FOUND,
        )
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Invalid verification token",
    )
