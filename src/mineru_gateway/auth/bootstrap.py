"""Startup seed for deployments that have no login flow.

Spec: specs/task-ownership.md §3.
"""

from __future__ import annotations

import uuid

from fastapi_users.password import PasswordHelper
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import User
from .provisioning import owner_user_create


async def ensure_bootstrap_owner(session: AsyncSession, email: str) -> uuid.UUID | None:
    """Create the configured bootstrap owner, or return ``None`` if it exists.

    Existing accounts are never modified, so a redeploy cannot rewrite
    credentials or verification state.
    """
    # Exact match on purpose: UserManager.create would match case-insensitively.
    existing = (
        await session.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()
    if existing is not None:
        return None

    create = owner_user_create(email, password=None)
    owner = User(
        email=create.email,
        hashed_password=PasswordHelper().hash(create.password),
        display_name=create.display_name,
        is_active=create.is_active,
        is_verified=create.is_verified,
        is_superuser=create.is_superuser,
    )
    session.add(owner)
    await session.commit()
    return owner.id
