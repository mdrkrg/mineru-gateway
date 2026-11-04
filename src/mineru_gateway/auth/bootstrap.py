"""Startup seed for deployments that have no login flow.

Spec: specs/task-ownership.md §3.
"""

from __future__ import annotations

import logging
import uuid

from fastapi_users.password import PasswordHelper
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import User
from .provisioning import owner_user_create
from .service import find_user_by_email

logger = logging.getLogger(__name__)


async def ensure_bootstrap_owner(session: AsyncSession, email: str) -> uuid.UUID | None:
    """Create the configured bootstrap owner, or return ``None`` if it exists.

    Existing accounts are never modified, so a redeploy cannot rewrite
    credentials or verification state. Existence is checked with the same
    ``lower(email)`` semantics as login, so a case variant cannot seed a
    duplicate that breaks every later lookup.
    """
    if await find_user_by_email(session, email) is not None:
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
    try:
        await session.commit()
    except IntegrityError:
        # A concurrent boot may have inserted the same identity.
        # Re-check after the rollback and let any other constraint failure abort startup.
        await session.rollback()
        if await find_user_by_email(session, email) is not None:
            logger.info("Bootstrap owner already exists (concurrent seed)")
            return None
        raise
    return owner.id
