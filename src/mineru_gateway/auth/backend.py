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


def issue_token_pair(user: User, settings: Settings) -> dict[str, str]:
    """Section 5.2: sign access + refresh token pair.

    Returns {access_token, refresh_token, token_type}.
    """
    raise NotImplementedError


async def verify_refresh_token(
    session: AsyncSession, token: str, settings: Settings
) -> User:
    """Section 5.2: verify refresh token signature, audience, expiry.

    Returns the active User. Raises on invalid/expired/wrong-audience token.
    """
    raise NotImplementedError
