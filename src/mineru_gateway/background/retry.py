"""Crash retry (§6.4). Fixed MAX_RETRIES, no separate exhausted terminal state.

Resubmits ``retry_pending`` tasks once upstream is healthy again, restoring the
staged multipart from the file cache. Transient failures consume a retry;
HTTP 429/5xx and transport failures consume a retry, while rejected requests
and malformed accepted responses fail immediately without consuming one.
"""

from __future__ import annotations

import asyncio
import logging

from ..db import Database
from ..tasks import service
from ..tasks.cache import FileCache
from ..upstream.client import UpstreamClient
from ..upstream.params import parse_v1_params
from ..upstream.schemas import gateway_task_status, validate_submission_payload

logger = logging.getLogger(__name__)


def _is_transient_submission_status(status_code: int) -> bool:
    """MinerU may temporarily reject work while its engine/router recovers."""
    return status_code == 429 or 500 <= status_code < 600


async def retry_once(
    db: Database,
    upstream: UpstreamClient,
    cache: FileCache,
    *,
    max_retries: int,
) -> None:
    async with db.session_factory() as session:
        tasks = await service.get_retryable(session)
    if not tasks:
        return

    # All records target the single configured upstream, so one probe is
    # sufficient for the whole pass.
    try:
        health = await upstream.get_health()
    except Exception:
        return
    if health.status != "healthy":
        return

    for task in tasks:
        # Staged files must still exist to resubmit.
        if not cache.exists(task.cache_dir):
            async with db.session_factory() as session:
                await service.mark_failed(
                    session, task.id, "cache missing; cannot resubmit"
                )
            continue

        try:
            data, files = await cache.restore(str(task.cache_dir))
            params = parse_v1_params(data, sync=False, include_zip=True)
            resp = await upstream.submit_task(params, files)
            if resp.status_code != 202:
                body_text = resp.text[:500]
                if _is_transient_submission_status(resp.status_code):
                    raise RuntimeError(
                        f"transient upstream response: {resp.status_code} - {body_text}"
                    )
                # The upstream rejected this request permanently. Fail
                # without consuming a retry.
                async with db.session_factory() as session:
                    await service.mark_failed(
                        session,
                        task.id,
                        f"unexpected upstream response: {resp.status_code}"
                        f" - {body_text}",
                    )
                await cache.release(task.cache_dir)
                continue
            try:
                raw_payload = resp.json()
            except ValueError as e:
                body_text = resp.text[:500]
                async with db.session_factory() as session:
                    await service.mark_failed(
                        session,
                        task.id,
                        f"non-JSON upstream response: {e} - {body_text}",
                    )
                await cache.release(task.cache_dir)
                continue
            try:
                payload = validate_submission_payload(raw_payload)
            except ValueError as exc:
                body_text = resp.text[:500]
                async with db.session_factory() as session:
                    await service.mark_failed(
                        session,
                        task.id,
                        f"invalid upstream task response: {exc} - {body_text}",
                    )
                await cache.release(task.cache_dir)
                continue

            async with db.session_factory() as session:
                await service.update(
                    session,
                    task.id,
                    {
                        "upstream_task_id": payload.task_id,
                        "status": gateway_task_status(payload.status),
                        "tier": payload.tier,
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
                payload.task_id,
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
