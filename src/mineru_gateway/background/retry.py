"""Crash retry (§6.4). Fixed MAX_RETRIES, no separate exhausted terminal state.

Resubmits ``retry_pending`` tasks once upstream is healthy again, restoring the
staged multipart from the file cache. Transient failures consume a retry;
malformed upstream responses fail immediately without consuming one.
"""

from __future__ import annotations

import asyncio
import logging

from ..db import Database
from ..tasks import service
from ..tasks.cache import FileCache
from ..upstream.client import UpstreamClient

logger = logging.getLogger(__name__)


async def retry_once(
    db: Database,
    upstream: UpstreamClient,
    cache: FileCache,
    *,
    max_retries: int,
) -> None:
    async with db.session_factory() as session:
        tasks = await service.get_retryable(session)

    for task in tasks:
        # Only resubmit once upstream is healthy again.
        try:
            health = await upstream.get_health()
        except Exception:
            continue
        if health.status != "healthy":
            continue

        # Staged files must still exist to resubmit.
        if not cache.exists(task.cache_dir):
            async with db.session_factory() as session:
                await service.mark_failed(
                    session, task.id, "cache missing; cannot resubmit"
                )
            continue

        try:
            data, files = await cache.restore(str(task.cache_dir))
            resp = await upstream.submit_task(data, files)
            payload = resp.json()
            if resp.status_code != 202 or "task_id" not in payload:
                # Non-transient: upstream rejected the request. Fail without
                # consuming a retry.
                async with db.session_factory() as session:
                    await service.mark_failed(
                        session,
                        task.id,
                        f"unexpected upstream response: {resp.status_code}",
                    )
                await cache.release(task.cache_dir)
                continue

            async with db.session_factory() as session:
                await service.update(
                    session,
                    task.id,
                    {
                        "upstream_task_id": payload["task_id"],
                        "status": "pending",
                        "retry_count": task.retry_count + 1,
                        "consecutive_poll_failures": 0,
                        "started_at": None,
                        "completed_at": None,
                        "error_message": None,
                    },
                )
            logger.info(
                "Retried task %s -> %s (attempt %s)",
                task.id,
                payload["task_id"],
                task.retry_count + 1,
            )
        except Exception as exc:
            # Transient failure (network/connection): consume a retry.
            new_count = task.retry_count + 1
            if new_count >= max_retries:
                async with db.session_factory() as session:
                    await service.mark_failed(session, task.id, str(exc))
                await cache.release(task.cache_dir)
            else:
                async with db.session_factory() as session:
                    await service.update(session, task.id, {"retry_count": new_count})
                logger.warning(
                    "Retry submit for %s failed (attempt %s): %s",
                    task.id,
                    new_count,
                    exc,
                )


async def retry_loop(
    db: Database,
    upstream: UpstreamClient,
    cache: FileCache,
    *,
    interval: float,
    max_retries: int,
) -> None:
    while True:
        await asyncio.sleep(interval)
        try:
            await retry_once(db, upstream, cache, max_retries=max_retries)
        except Exception:  # pragma: no cover - loop must not die
            logger.exception("retry pass failed")
