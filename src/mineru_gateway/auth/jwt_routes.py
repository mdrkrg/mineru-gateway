"""JWT auth routes: login, refresh, logout, register, admin-create (Section 5.1).

Spec: user-management-and-oauth.md Section 4.1 (JWT), 4.2 (register, admin create).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from .dependencies import get_session, get_settings_dep, require_admin_token
from .schemas import RefreshTokenRequest, TokenPair, UserCreate, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/jwt/login", response_model=TokenPair)
async def login(
    body: UserCreate,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> TokenPair:
    """Section 4.1: email + password -> {access, refresh, token_type}."""
    raise NotImplementedError


@router.post("/jwt/refresh")
async def refresh(
    body: RefreshTokenRequest,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> dict:
    """Section 4.1: refresh_token -> new {access_token, token_type}."""
    raise NotImplementedError


@router.post("/jwt/logout")
async def logout(
    request: Request,
    response: Response,
) -> dict:
    """Section 4.1: stateless logout, returns 200 {"message": "Logged out"}."""
    raise NotImplementedError


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(
    body: UserCreate,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> UserRead:
    """Section 4.2: public registration, gated by OPEN_REGISTRATION."""
    raise NotImplementedError


@router.post(
    "/users",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_token)],
)
async def admin_create_user(
    body: UserCreate,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> UserRead:
    """Section 4.2: admin creates user (X-Admin-Token, not gated by OPEN_REGISTRATION)."""
    raise NotImplementedError
