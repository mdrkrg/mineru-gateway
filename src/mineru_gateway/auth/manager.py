"""UserManager and FastAPIUsers instance (Section 5.1, 5.2).

Spec: user-management-and-oauth.md Section 5.2 (UserManager interfaces).
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, Request, Response
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.db import SQLAlchemyUserDatabase

from ..config import Settings
from ..models import User
from .backend import create_auth_backend
from .dependencies import get_settings_dep, get_user_db


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    """Section 5.2: user lifecycle callbacks + password validation."""

    settings: Settings

    def __init__(self, user_db: SQLAlchemyUserDatabase, settings: Settings) -> None:
        super().__init__(user_db)
        self.settings = settings

    async def validate_password(self, password: str, user) -> None:
        """Section 7.4 / 5.2: password >= 8 chars, must not contain email."""
        raise NotImplementedError

    async def on_after_register(
        self, user: User, request: Request | None = None
    ) -> None:
        """Section 5.2: log 'User {id} registered'."""
        raise NotImplementedError

    async def on_after_login(
        self,
        user: User,
        request: Request | None = None,
        response: Response | None = None,
    ) -> None:
        """Section 5.2: log 'User {id} logged in'."""
        raise NotImplementedError


async def get_user_manager(
    user_db: Annotated[SQLAlchemyUserDatabase, Depends(get_user_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db, settings)


_fastapi_users: FastAPIUsers[User, uuid.UUID] | None = None


def get_fastapi_users(settings: Settings) -> FastAPIUsers[User, uuid.UUID]:
    """Lazily create the FastAPIUsers singleton bound to settings."""
    global _fastapi_users
    if _fastapi_users is None:
        _fastapi_users = FastAPIUsers[User, uuid.UUID](
            get_user_manager, [create_auth_backend(settings)]
        )
    return _fastapi_users
