"""FastAPI dependencies for authentication."""

from __future__ import annotations

import secrets
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from ..models import OAuthAccount, User
from . import service
from .principals import AuthType, TaskPrincipal, ensure_verified


X_API_KEY = APIKeyHeader(name="X-API-Key", auto_error=False)
# Declared so the JWT is part of the OpenAPI contract; parsing stays in
# ``user_from_bearer`` because the token is optional here.
BEARER = HTTPBearer(auto_error=False, description="JWT access token")
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


async def require_task_principal(
    request: Request,
    x_api_key: str | None = Depends(X_API_KEY),
    bearer: HTTPAuthorizationCredentials | None = Depends(BEARER),
    settings: Settings = Depends(get_settings_dep),
    session: AsyncSession = Depends(get_session),
) -> TaskPrincipal | None:
    """Resolve a task caller from X-API-Key or a Bearer JWT.

    The API key takes precedence so existing clients keep their exact
    behavior even when the web client also attaches a JWT. Without either
    credential, anonymous passthrough is allowed only when configured.
    """
    if x_api_key is not None:
        api_key = await service.verify_key(session, x_api_key)
        if api_key is None:
            raise HTTPException(status_code=401, detail="Invalid API key")
        request.state.api_key_id = str(api_key.id)
        request.state.auth_type = AuthType.API_KEY.value
        request.state.owner_id = str(api_key.owner_id)
        return TaskPrincipal.from_api_key(api_key)

    if settings.user_auth_enabled:
        user = await user_from_bearer(request, bearer, settings, session)
        if user is not None:
            request.state.auth_type = AuthType.JWT.value
            request.state.owner_id = str(user.id)
            return TaskPrincipal.from_user(user)

    if settings.allow_anonymous:
        request.state.auth_type = "anonymous"
        return None
    raise HTTPException(status_code=401, detail="Authentication required")


# ===== User management dependencies (Section 5.3) =====


async def get_user_db(
    session: AsyncSession = Depends(get_session),
) -> AsyncIterator[SQLAlchemyUserDatabase]:
    """Section 5.3: yields SQLAlchemyUserDatabase for User + OAuthAccount."""
    yield SQLAlchemyUserDatabase(session, User, OAuthAccount)


async def user_from_bearer(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
    settings: Settings,
    session: AsyncSession,
) -> User | None:
    """Return the active JWT user, or None when no Bearer token is present.

    An invalid/expired token raises 401 instead of silently downgrading to
    anonymous; explicit credentials should never be ignored.
    """
    from .backend import get_jwt_strategy
    from .manager import UserManager

    if credentials is None:
        return None
    token = credentials.credentials

    user_db = SQLAlchemyUserDatabase(session, User, OAuthAccount)
    user_manager = UserManager(user_db, settings)
    strategy = get_jwt_strategy(settings)
    user = await strategy.read_token(token, user_manager)
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Not authenticated")
    request.state.user_id = str(user.id)
    return user


async def current_active_user(
    request: Request,
    bearer: HTTPAuthorizationCredentials | None = Depends(BEARER),
    settings: Settings = Depends(get_settings_dep),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Section 4.3/4.4: JWT (access token) -> active User, else 401."""
    user = await user_from_bearer(request, bearer, settings, session)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


async def require_verified_user(
    user: Annotated[User, Depends(current_active_user)],
    settings: Settings = Depends(get_settings_dep),
) -> User:
    """Section 4.4/9.6: verification gate for self-service API keys.

    Spec: user-management-and-oauth.md Section 3.1/4.4
    (GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS, default false -> 403).
    """
    ensure_verified(user.is_verified, settings)
    return user
