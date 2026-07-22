"""User info routes: GET/PATCH /users/me (Section 5.1).

Spec: user-management-and-oauth.md Section 4.3.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from .dependencies import get_session, get_settings_dep
from .schemas import UserRead, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserRead)
async def get_me(
    settings: Settings = Depends(get_settings_dep),
    session: AsyncSession = Depends(get_session),
) -> UserRead:
    """Section 4.3: return current authenticated user info."""
    raise NotImplementedError


@router.patch("/me", response_model=UserRead)
async def update_me(
    body: UserUpdate,
    settings: Settings = Depends(get_settings_dep),
    session: AsyncSession = Depends(get_session),
) -> UserRead:
    """Section 4.3: update display_name / password. email not mutable."""
    raise NotImplementedError
