"""FastAPI dependencies for authentication."""

from __future__ import annotations

import secrets
from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyHeader
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from ..models import ApiKey, OAuthAccount, User
from . import service


X_API_KEY = APIKeyHeader(name="X-API-Key", auto_error=False)
X_ADMIN_TOKEN = APIKeyHeader(name="X-Admin-Token")


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.db.session_factory() as session:
        yield session


async def require_admin_token(
    x_admin_token: str = Depends(X_ADMIN_TOKEN),
    settings: Settings = Depends(get_settings_dep),
) -> None:
    if not secrets.compare_digest(x_admin_token, settings.admin_token):
        raise HTTPException(status_code=401, detail="Invalid or missing admin token")


async def require_api_key(
    request: Request,
    x_api_key: str | None = Depends(X_API_KEY),
    settings: Settings = Depends(get_settings_dep),
    session: AsyncSession = Depends(get_session),
) -> ApiKey | None:
    """Resolve the caller's ApiKey.

    - If a key is supplied it must be valid, else 401.
    - If no key is supplied: allowed (returns None) only when ALLOW_ANONYMOUS.
    """
    if x_api_key is None:
        if settings.allow_anonymous:
            return None
        raise HTTPException(status_code=401, detail="API key required")

    api_key = await service.verify_key(session, x_api_key)
    if api_key is None:
        raise HTTPException(status_code=401, detail="Invalid API key")
    request.state.api_key_id = str(api_key.id)
    return api_key


# ===== User management dependencies (Section 5.3) =====


async def get_user_db(
    session: AsyncSession = Depends(get_session),
) -> AsyncIterator[SQLAlchemyUserDatabase]:
    """Section 5.3: yields SQLAlchemyUserDatabase for User + OAuthAccount."""
    yield SQLAlchemyUserDatabase(session, User, OAuthAccount)


async def current_active_user(
    request: Request,
    settings: Settings = Depends(get_settings_dep),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Section 4.3/4.4: JWT (access token) -> active User, else 401."""
    from fastapi_users.db import SQLAlchemyUserDatabase

    from .manager import UserManager

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth[7:]

    user_db = SQLAlchemyUserDatabase(session, User, OAuthAccount)
    user_manager = UserManager(user_db, settings)
    from .backend import get_jwt_strategy

    strategy = get_jwt_strategy(settings)
    user = await strategy.read_token(token, user_manager)
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user
