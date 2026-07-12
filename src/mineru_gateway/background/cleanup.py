"""Cleanup (§3.4, §6.5): delete expired task records + their cache dirs, and
prune the in-memory rate limiter.
"""

from __future__ import annotations

import asyncio
import logging

from ..db import Database
from ..limiter.memory import MemoryTokenBucket
from ..tasks import service
from ..tasks.cache import FileCache

logger = logging.getLogger(__name__)


async def cleanup_once(
    db: Database,
    limiter: MemoryTokenBucket,
    *,
    retention_days: int,
    cache: FileCache | None = None,
) -> None:
    async with db.session_factory() as session:
        cache_dirs = await service.delete_expired(session, retention_days)

    if cache is not None:
        for cache_dir in cache_dirs:
            await cache.release(cache_dir)

    await limiter.prune()


async def cleanup_loop(
    db: Database,
    limiter: MemoryTokenBucket,
    *,
    interval: float,
    retention_days: int,
    cache: FileCache | None = None,
) -> None:
    while True:
        await asyncio.sleep(interval)
        try:
            await cleanup_once(db, limiter, retention_days=retention_days, cache=cache)
        except Exception:  # pragma: no cover - loop must not die
            logger.exception("cleanup pass failed")
