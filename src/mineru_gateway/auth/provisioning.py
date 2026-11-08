"""User provisioning shared by public registration and the admin plane.

Both entry points create the same ``users`` rows; they differ only in who may
call them and whether a password is supplied. Spec: specs/task-ownership.md §3.
"""

from __future__ import annotations

import secrets

from fastapi import HTTPException, Request
from fastapi_users import exceptions

from ..config import Settings
from ..utils.email import AsciiEmail
from .manager import UserManager
from .schemas import AdminUserCreate, UserCreate, UserRead


async def send_verification_email_after_create(
    user,
    user_manager: UserManager,
    settings: Settings,
    request: Request,
) -> None:
    """Auto-send the verification email after register / admin create.

    Spec: email-verification.md Section 4.4.

    - Not hooked into ``on_after_register``: the OIDC callback fires that hook
      and must never auto-send.
    - No mailbox flow, no send: without SMTP or with the login stack off the
      verify routes are not registered, so the link would 404.
    - Send failures are swallowed by ``on_after_request_verify``, so the
      create result is unaffected.
    """
    if not settings.mailbox_flow_enabled:
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


def owner_user_create(
    email: AsciiEmail,
    *,
    password: str | None,
    display_name: str | None = None,
    is_active: bool = True,
    is_superuser: bool = False,
    is_verified: bool | None = None,
) -> UserCreate:
    """Section 3: a missing password means a credential-only owner.

    The generated password is hashed and discarded, so the row can own keys and
    tasks but cannot sign in. ``is_verified`` defaults to true for that shape
    (there is no mailbox flow to complete) and to false for login-capable
    owners, which must verify their address.
    """
    login_capable = password is not None
    return UserCreate(
        email=email,
        password=password or secrets.token_urlsafe(32),
        display_name=display_name,
        is_active=is_active,
        is_superuser=is_superuser,
        is_verified=(is_verified if is_verified is not None else not login_capable),
    )


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

    Without a mailbox flow the admin's assertion is the only proof, so the row
    is verified and ``is_verified=false`` is refused (Section 2).
    """
    blocker = None
    if not settings.user_auth_enabled:
        blocker = "GATEWAY_USER_AUTH_ENABLED"
    elif settings.smtp_host is None:
        blocker = "GATEWAY_SMTP_HOST"

    is_verified = body.is_verified
    if blocker is not None:
        if is_verified is False:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"is_verified=false requires {blocker}: no verification "
                    f"flow exists, so the address could never be verified"
                ),
            )
        is_verified = True

    return await create_user(
        owner_user_create(
            body.email,
            password=body.password,
            display_name=body.display_name,
            is_active=body.is_active,
            is_superuser=body.is_superuser,
            is_verified=is_verified,
        ),
        request,
        user_manager,
        settings,
        safe=False,
    )
