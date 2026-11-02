"""User provisioning shared by public registration and the admin plane.

Both entry points create the same ``users`` rows; they differ only in who may
call them and whether a password is supplied. Spec: specs/task-ownership.md §3.
"""

from __future__ import annotations

import secrets

from fastapi import HTTPException, Request
from fastapi_users import exceptions

from ..config import Settings
from .manager import UserManager
from .schemas import AdminUserCreate, UserCreate, UserRead


async def send_verification_email_after_create(
    user,
    user_manager: UserManager,
    settings: Settings,
    request: Request,
) -> None:
    """Auto-send the verification email after register / admin create.

    Spec: email-verification.md Section 4.4. Deliberately not hooked into
    on_after_register: the OIDC callback also fires that hook and must never
    auto-send. Send failures are swallowed by on_after_request_verify, so the
    create result is unaffected.
    """
    if settings.smtp_host is None:
        return
    try:
        await user_manager.request_verify(user, request)
    except exceptions.UserAlreadyVerified, exceptions.UserInactive:
        pass


async def create_user(
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
    await send_verification_email_after_create(user, user_manager, settings, request)
    return UserRead.model_validate(user)


async def provision_owner(
    body: AdminUserCreate,
    request: Request,
    user_manager: UserManager,
    settings: Settings,
) -> UserRead:
    """Create an owner from the admin plane.

    A missing password means "credential-only owner": the generated password is
    hashed and discarded, so the row can own keys and tasks but cannot sign in.
    Supplying a password creates a normal login account instead.
    """
    login_capable = body.password is not None
    user_create = UserCreate(
        email=body.email,
        password=body.password or secrets.token_urlsafe(32),
        display_name=body.display_name,
        is_active=body.is_active,
        is_superuser=body.is_superuser,
        is_verified=(
            body.is_verified if body.is_verified is not None else not login_capable
        ),
    )
    return await create_user(user_create, request, user_manager, settings, safe=False)
