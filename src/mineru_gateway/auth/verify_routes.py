"""Email-link verification endpoint (spec: email-verification.md Section 4.3).

GET /auth/verify?token= performs the same verification as the fastapi-users
POST /auth/verify route, but is usable directly from a link inside the
verification email (browsers cannot easily issue POSTs).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi_users import exceptions
from starlette.responses import RedirectResponse

from ..config import Settings
from .dependencies import get_settings_dep
from .manager import UserManager, get_user_manager
from .schemas import UserRead

router = APIRouter(prefix="/auth", tags=["auth"])

_VERIFY_ERRORS = (
    exceptions.InvalidVerifyToken,
    exceptions.UserAlreadyVerified,
)


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
      redirect URL is configured.
    - Failure (invalid / expired / mismatched token, already verified):
      400, or 302 to ``{oauth_frontend_redirect_url}#verified=false``.
    """
    redirect_url = settings.oauth_frontend_redirect_url
    try:
        user = await user_manager.verify(token, request)
    except _VERIFY_ERRORS:
        if redirect_url:
            return RedirectResponse(
                f"{redirect_url}#verified=false",
                status_code=status.HTTP_302_FOUND,
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification token",
        )
    if redirect_url:
        return RedirectResponse(
            f"{redirect_url}#verified=true",
            status_code=status.HTTP_302_FOUND,
        )
    return UserRead.model_validate(user)
