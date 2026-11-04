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
    if not settings.user_auth_enabled or settings.smtp_host is None:
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

    Without SMTP there is no mailbox flow, so the admin's assertion is the only
    proof of ownership: the row is verified by default, and
    ``is_verified=false`` is refused because nothing could ever verify it.

    The same holds with the login stack off (``GATEWAY_USER_AUTH_ENABLED=false``):
    the row can only own keys and tasks, and the verify routes are not
    registered, so verification has no consumer either.
    """
    is_verified = body.is_verified
    if not settings.user_auth_enabled:
        if is_verified is False:
            # No login stack means no verify route either, so nothing could
            # ever flip the flag.
            raise HTTPException(
                status_code=400,
                detail=(
                    "is_verified=false requires GATEWAY_USER_AUTH_ENABLED: "
                    "without the login stack no verification flow exists"
                ),
            )
        is_verified = True
    elif settings.smtp_host is None:
        if is_verified is False:
            # Such a row could never be verified or linked to a provider login.
            raise HTTPException(
                status_code=400,
                detail=(
                    "is_verified=false requires GATEWAY_SMTP_HOST: without a "
                    "mailbox flow the owner could never verify the address"
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
