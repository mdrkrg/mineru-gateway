"""Background status synchronization (§6.3).

Polls upstream for the status of non-terminal tasks and mirrors it into the DB.
If upstream is unreachable, or a task's poll repeatedly fails, the task is
flagged retryable (when its staged files are still present).

MVP targets a single upstream, so health is probed once per pass rather than
per upstream_url group.
"""

from __future__ import annotations

import asyncio
import logging

from ..db import Database
from ..tasks import service
from ..upstream.client import UpstreamClient

logger = logging.getLogger(__name__)


async def sync_once(
    db: Database, upstream: UpstreamClient, *, poll_failure_threshold: int
) -> None:
    async with db.session_factory() as session:
        tasks = await service.get_non_terminal(session)
    if not tasks:
        return

    # Probe upstream health once; if unreachable, consider all tasks retryable.
    try:
        await upstream.get_health()
        reachable = True
    except Exception:
        reachable = False

    for task in tasks:
        if not reachable:
            async with db.session_factory() as session:
                await service.mark_retryable(session, task.id)
            continue

        try:
            resp = await upstream.get_task_status(str(task.upstream_task_id))
            resp.raise_for_status()
            upstream_status = resp.json()
        except Exception:
            new_failures = task.consecutive_poll_failures + 1
            async with db.session_factory() as session:
                await service.update(
                    session,
                    task.id,
                    {"consecutive_poll_failures": new_failures},
                )
                if new_failures >= poll_failure_threshold:
                    await service.mark_retryable(session, task.id)
            continue

        async with db.session_factory() as session:
            await service.update_from_upstream(session, task.id, upstream_status)


async def status_sync_loop(
    db: Database,
    upstream: UpstreamClient,
    *,
    interval: float,
    poll_failure_threshold: int,
) -> None:
    while True:
        await asyncio.sleep(interval)
        try:
            await sync_once(db, upstream, poll_failure_threshold=poll_failure_threshold)
        except Exception:  # pragma: no cover - loop must not die
            logger.exception("status_sync pass failed")
