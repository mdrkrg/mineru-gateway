"""JWT authentication backend (Section 5.2).

Spec: user-management-and-oauth.md Section 5.2 (issue_token_pair, verify_refresh_token).
"""

from __future__ import annotations

from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from ..models import User


def get_jwt_strategy(settings: Settings) -> JWTStrategy:
    """Section 7.1: JWT strategy using GATEWAY_JWT_SECRET, access audience."""
    return JWTStrategy(
        secret=settings.jwt_secret,
        lifetime_seconds=settings.jwt_access_lifetime_seconds,
        token_audience=["fastapi-users:auth"],
    )


def get_refresh_jwt_strategy(settings: Settings) -> JWTStrategy:
    """Section 7.1: refresh token strategy, refresh audience."""
    return JWTStrategy(
        secret=settings.jwt_secret,
        lifetime_seconds=settings.jwt_refresh_lifetime_seconds,
        token_audience=["fastapi-users:refresh"],
    )


bearer_transport = BearerTransport(tokenUrl="auth/jwt/login")


def create_auth_backend(settings: Settings) -> AuthenticationBackend:
    """Section 5.1: JWT auth backend (bearer transport + strategy)."""
    return AuthenticationBackend(
        name="jwt",
        transport=bearer_transport,
        get_strategy=lambda: get_jwt_strategy(settings),
    )


async def issue_token_pair(user: User, settings: Settings) -> dict[str, str]:
    """Section 5.2: sign access + refresh token pair.

    Returns {access_token, refresh_token, token_type}.
    """
    access_strategy = get_jwt_strategy(settings)
    refresh_strategy = get_refresh_jwt_strategy(settings)
    access_token = await access_strategy.write_token(user)
    refresh_token = await refresh_strategy.write_token(user)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
    }


async def verify_refresh_token(
    session: AsyncSession, token: str, settings: Settings
) -> User | None:
    """Section 5.2: verify refresh token signature, audience, expiry.

    Returns the active User, or None if invalid/expired/wrong-audience.
    """
    from fastapi_users.db import SQLAlchemyUserDatabase

    from ..models import OAuthAccount
    from .manager import UserManager

    user_db = SQLAlchemyUserDatabase(session, User, OAuthAccount)
    user_manager = UserManager(user_db, settings)
    strategy = get_refresh_jwt_strategy(settings)
    user = await strategy.read_token(token, user_manager)
    if user is None or not user.is_active:
        return None
    return user
