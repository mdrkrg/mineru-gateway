"""API Key issuance / listing / revocation / verification.

Keys are stored as SHA256 hashes; the plaintext is only ever returned once at
creation time.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ApiKey

_KEY_BYTES = 32
_PREFIX_LEN = 8


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


def generate_raw_key() -> str:
    return f"mru_{secrets.token_urlsafe(_KEY_BYTES)}"


async def create_key(
    session: AsyncSession,
    label: str | None = None,
    expires_at: datetime | None = None,
) -> tuple[ApiKey, str]:
    """Create a key, returning (record, plaintext)."""
    raw = generate_raw_key()
    record = ApiKey(
        key_hash=_hash_key(raw),
        key_prefix=raw[:_PREFIX_LEN],
        label=label or "",
        expires_at=expires_at,
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record, raw


async def list_keys(session: AsyncSession) -> list[ApiKey]:
    result = await session.execute(select(ApiKey).order_by(ApiKey.created_at.desc()))
    return list(result.scalars().all())


async def revoke_key(session: AsyncSession, key_id: str) -> bool:
    record = await session.get(ApiKey, key_id)
    if record is None:
        return False
    record.is_active = False
    await session.commit()
    return True


async def verify_key(session: AsyncSession, raw_key: str) -> ApiKey | None:
    """Return the active, non-expired ApiKey matching raw_key, else None."""
    result = await session.execute(
        select(ApiKey).where(ApiKey.key_hash == _hash_key(raw_key))
    )
    record = result.scalar_one_or_none()
    if record is None or not record.is_active:
        return None
    now = datetime.now(timezone.utc)
    if record.expires_at is not None:
        expires_at = record.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now:
            return None
    record.last_used_at = now
    await session.commit()
    return record
