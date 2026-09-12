"""JWT auth routes: login, refresh, logout, register, admin-create (Section 5.1).

Spec: user-management-and-oauth.md Section 4.1 (JWT), 4.2 (register, admin create).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi_users import exceptions
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from ..models import User
from .backend import issue_token_pair, verify_refresh_token
from .dependencies import (
    current_active_user,
    get_session,
    get_settings_dep,
    get_user_db,
    require_admin_token,
)
from .manager import UserManager
from .schemas import LoginRequest, RefreshTokenRequest, TokenPair, UserCreate, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


async def get_user_manager_dep(
    user_db: Annotated[SQLAlchemyUserDatabase, Depends(get_user_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> UserManager:
    return UserManager(user_db, settings)


async def _send_verification_email_after_create(
    user: User,
    user_manager: UserManager,
    settings: Settings,
    request: Request,
) -> None:
    """Spec: email-verification.md Section 4.4 - auto-send the verification
    email after register / admin create when SMTP is configured.

    Deliberately not hooked into on_after_register: the OIDC callback also
    fires on_after_register and must never auto-send. Send failures are
    swallowed by on_after_request_verify, so the create result is unaffected.
    """
    if settings.smtp_host is None:
        return
    try:
        await user_manager.request_verify(user, request)
    except exceptions.UserAlreadyVerified, exceptions.UserInactive:
        pass


async def _create_user(
    body: UserCreate,
    request: Request,
    user_manager: UserManager,
    settings: Settings,
    *,
    safe: bool = True,
) -> UserRead:
    """Section 4.2 + 4.4: shared tail of register / admin create.

    ``safe=True`` (public registration) strips privileged flags. The
    admin-token gated route passes ``safe=False`` so is_superuser /
    is_active / is_verified are honoured.
    """
    try:
        user = await user_manager.create(body, safe=safe, request=request)
    except exceptions.InvalidPasswordException:
        raise HTTPException(status_code=400, detail="Password does not meet rules")
    except exceptions.UserAlreadyExists:
        raise HTTPException(status_code=400, detail="Email already registered")
    await _send_verification_email_after_create(user, user_manager, settings, request)
    return UserRead.model_validate(user)


@router.post("/jwt/login", response_model=TokenPair)
async def login(
    body: LoginRequest,
    request: Request,
    user_manager: Annotated[UserManager, Depends(get_user_manager_dep)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> TokenPair:
    """Section 4.1: email + password -> {access, refresh, token_type}."""
    try:
        user = await user_manager.get_by_email(body.email)
    except exceptions.UserNotExists:
        user_manager.password_helper.hash(body.password)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    verified, updated_password_hash = user_manager.password_helper.verify_and_update(
        body.password, user.hashed_password
    )
    if not verified:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if updated_password_hash is not None:
        await user_manager.user_db.update(
            user, {"hashed_password": updated_password_hash}
        )
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    await user_manager.on_after_login(user, request=request, response=None)
    tokens = await issue_token_pair(user, settings)
    return TokenPair(**tokens)


@router.post("/jwt/refresh")
async def refresh(
    body: RefreshTokenRequest,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> dict:
    """Section 4.1: refresh_token -> new {access_token, token_type}."""
    user = await verify_refresh_token(session, body.refresh_token, settings)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    from .backend import get_jwt_strategy

    strategy = get_jwt_strategy(settings)
    access_token = await strategy.write_token(user)
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/jwt/logout")
async def logout(
    user: User = Depends(current_active_user),
) -> dict:
    """Section 4.1: stateless logout, returns 200 {"message": "Logged out"}."""
    return {"message": "Logged out"}


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(
    body: UserCreate,
    request: Request,
    user_manager: Annotated[UserManager, Depends(get_user_manager_dep)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> UserRead:
    """Section 4.2: public registration, gated by OPEN_REGISTRATION."""
    if not settings.open_registration:
        raise HTTPException(status_code=403, detail="Registration is closed")
    return await _create_user(body, request, user_manager, settings)


@router.post(
    "/users",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_token)],
)
async def admin_create_user(
    body: UserCreate,
    request: Request,
    user_manager: Annotated[UserManager, Depends(get_user_manager_dep)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> UserRead:
    """Section 4.2: admin creates user (X-Admin-Token, not gated by OPEN_REGISTRATION)."""
    return await _create_user(body, request, user_manager, settings, safe=False)
