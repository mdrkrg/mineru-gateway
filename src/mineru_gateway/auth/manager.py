"""UserManager and FastAPIUsers instance (Section 5.1, 5.2).

Spec: user-management-and-oauth.md Section 5.2 (UserManager interfaces).
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, Request, Response
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin, exceptions
from fastapi_users.db import SQLAlchemyUserDatabase

from ..config import Settings
from ..email import service as email_service
from ..models import User
from .backend import create_auth_backend
from .dependencies import get_settings_dep, get_user_db

logger = logging.getLogger(__name__)


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    """Section 5.2: user lifecycle callbacks + password validation."""

    settings: Settings

    def __init__(self, user_db: SQLAlchemyUserDatabase, settings: Settings) -> None:
        super().__init__(user_db)
        self.settings = settings
        # Spec: email-verification.md Section 5.3 - verification tokens are
        # signed with the JWT secret and expire per VERIFY_EMAIL_TOKEN_LIFETIME.
        self.verification_token_secret = settings.jwt_secret
        self.verification_token_lifetime_seconds = (
            settings.verify_email_token_lifetime_seconds
        )

    async def validate_password(self, password: str, user) -> None:
        """Section 7.4 / 5.2: password >= 8 chars, must not contain email."""
        if len(password) < 8:
            raise exceptions.InvalidPasswordException(
                reason="Password must be at least 8 characters"
            )
        if user.email and user.email.lower() in password.lower():
            raise exceptions.InvalidPasswordException(
                reason="Password must not contain the email address"
            )

    async def on_after_register(
        self, user: User, request: Request | None = None
    ) -> None:
        """Section 5.2: log 'User {id} registered'."""
        logger.info("User %s registered", user.id)

    async def on_after_login(
        self,
        user: User,
        request: Request | None = None,
        response: Response | None = None,
    ) -> None:
        """Section 5.2: log 'User {id} logged in'."""
        logger.info("User %s logged in", user.id)

    async def on_after_request_verify(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        """Spec: email-verification.md Section 5.2 - send the verification
        email with the freshly minted token. Send failures are logged and
        never raised, so register / admin create / request-verify-token
        results are unaffected (Section 4.4)."""
        try:
            await email_service.send_verification_email(
                user.email, token, self.settings
            )
        except Exception:
            logger.exception("Failed to send verification email to %s", user.email)

    async def on_after_verify(self, user: User, request: Request | None = None) -> None:
        """Spec: email-verification.md Section 5.2 - log 'User {id} verified'."""
        logger.info("User %s verified", user.id)


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
