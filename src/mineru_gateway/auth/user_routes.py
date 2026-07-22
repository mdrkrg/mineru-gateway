"""User info routes: GET/PATCH /users/me (Section 5.1).

Spec: user-management-and-oauth.md Section 4.3.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi_users import exceptions
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from ..models import User
from .dependencies import current_active_user, get_session, get_settings_dep
from .manager import UserManager
from .schemas import UserRead, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


async def _get_user_manager(
    session: AsyncSession,
    settings: Settings,
) -> UserManager:
    from fastapi_users.db import SQLAlchemyUserDatabase

    from ..models import OAuthAccount

    user_db = SQLAlchemyUserDatabase(session, User, OAuthAccount)
    return UserManager(user_db, settings)


@router.get("/me", response_model=UserRead)
async def get_me(
    user: Annotated[User, Depends(current_active_user)],
) -> UserRead:
    """Section 4.3: return current authenticated user info."""
    return UserRead.model_validate(user)


@router.patch("/me", response_model=UserRead)
async def update_me(
    body: UserUpdate,
    user: Annotated[User, Depends(current_active_user)],
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> UserRead:
    """Section 4.3: update display_name / password. email not mutable."""
    user_manager = await _get_user_manager(session, settings)
    update_data = body.model_dump(exclude_unset=True, exclude={"email"})
    if not update_data:
        return UserRead.model_validate(user)
    user_update = UserUpdate(**update_data)
    try:
        updated = await user_manager.update(user_update, user, safe=True, request=None)
    except exceptions.InvalidPasswordException:
        raise HTTPException(status_code=400, detail="Password does not meet rules")
    return UserRead.model_validate(updated)
