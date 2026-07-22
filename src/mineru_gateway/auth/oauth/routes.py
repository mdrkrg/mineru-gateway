"""OAuth / OIDC routes: authorize, callback (Section 5.1).

Spec: user-management-and-oauth.md Section 4.5.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from ..dependencies import get_session, get_settings_dep

router = APIRouter(prefix="/auth/oauth", tags=["oauth"])


@router.get("/{provider}/authorize")
async def authorize(
    provider: str,
    request: Request,
    settings=Depends(get_settings_dep),
) -> Response:
    """Section 4.5: 302 redirect to OIDC provider + set CSRF state cookie."""
    raise NotImplementedError


@router.get("/{provider}/callback", response_model=None)
async def callback(
    provider: str,
    request: Request,
    code: str,
    state: str,
    session: AsyncSession = Depends(get_session),
    settings=Depends(get_settings_dep),
):
    """Section 4.5: exchange code, upsert User + OAuthAccount, issue tokens.

    Returns TokenPair JSON or 302 redirect depending on frontend_redirect_url.
    """
    raise NotImplementedError
