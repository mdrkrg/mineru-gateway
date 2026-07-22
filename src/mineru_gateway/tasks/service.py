"""Task metadata CRUD + ownership checks."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timezone, timedelta
from typing import Any

from sqlalchemy import String, func, select
from sqlalchemy.ext.asyncio import AsyncSession


from ..models import TaskRecord


async def create(session: AsyncSession, **fields: Any) -> TaskRecord:
    task = TaskRecord(**fields)
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


async def get(session: AsyncSession, task_id: uuid.UUID) -> TaskRecord | None:
    return await session.get(TaskRecord, task_id)


async def get_owned(
    session: AsyncSession, task_id: uuid.UUID, api_key_id: uuid.UUID
) -> TaskRecord | None:
    task = await session.get(TaskRecord, task_id)
    if task is None or task.api_key_id != api_key_id:
        return None
    return task


def _build_filters(
    api_key_id: uuid.UUID,
    status: str | None,
    backend: str | None,
    file_name: str | None,
    date_from: date | None,
    date_to: date | None,
) -> list:
    conditions = [TaskRecord.api_key_id == api_key_id]
    if status:
        conditions.append(TaskRecord.status == status)
    if backend:
        conditions.append(TaskRecord.backend == backend)
    if file_name:
        # file_names is stored as serialized JSON text; a substring match over
        # the serialized list is sufficient for the MVP fuzzy search.
        conditions.append(TaskRecord.file_names.cast(String).like(f"%{file_name}%"))
    if date_from:
        conditions.append(
            TaskRecord.created_at
            >= datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        )
    if date_to:
        conditions.append(
            TaskRecord.created_at
            <= datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        )
    return conditions


async def list_tasks(
    session: AsyncSession,
    api_key_id: uuid.UUID,
    *,
    status: str | None = None,
    backend: str | None = None,
    file_name: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[TaskRecord], int]:
    conditions = _build_filters(
        api_key_id, status, backend, file_name, date_from, date_to
    )

    total = await session.scalar(
        select(func.count()).select_from(TaskRecord).where(*conditions)
    )

    result = await session.execute(
        select(TaskRecord)
        .where(*conditions)
        .order_by(TaskRecord.created_at.desc(), TaskRecord.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list(result.scalars().all()), int(total or 0)


async def mark_cancelled(session: AsyncSession, task: TaskRecord) -> str | None:
    """Mark a task cancelled. Returns its cache_dir (now orphaned) to release."""
    task.status = "cancelled"
    task.completed_at = datetime.now(timezone.utc)
    released = task.cache_dir
    task.cache_dir = None
    await session.commit()
    await session.refresh(task)
    return released


# --- Phase 3: background recovery helpers ---

# Statuses that are settled and no longer change.
TERMINAL_STATES = ("completed", "failed", "cancelled")
# Upstream statuses mapped onto gateway statuses.
_UPSTREAM_STATUS_MAP = {
    "pending": "pending",
    "queued": "pending",
    "processing": "processing",
    "running": "processing",
    "completed": "completed",
    "success": "completed",
    "done": "completed",
    "failed": "failed",
    "error": "failed",
    "cancelled": "cancelled",
    "canceled": "cancelled",
}


async def get_non_terminal(session: AsyncSession) -> list[TaskRecord]:
    """Tasks still expected to progress at upstream (pending/processing)."""
    result = await session.execute(
        select(TaskRecord).where(
            TaskRecord.status.in_(("pending", "processing")),
            TaskRecord.upstream_task_id.is_not(None),
        )
    )
    return list(result.scalars().all())


async def count_in_flight(session: AsyncSession) -> int:
    """Count tasks occupying a global concurrency slot (pending + processing)."""
    total = await session.scalar(
        select(func.count())
        .select_from(TaskRecord)
        .where(TaskRecord.status.in_(("pending", "processing", "retry_pending")))
    )
    return int(total or 0)


async def get_retryable(session: AsyncSession) -> list[TaskRecord]:
    """Tasks flagged for resubmission after an upstream crash."""
    result = await session.execute(
        select(TaskRecord).where(TaskRecord.status == "retry_pending")
    )
    return list(result.scalars().all())


async def update(session: AsyncSession, task_id: uuid.UUID, fields: dict) -> None:
    task = await session.get(TaskRecord, task_id)
    if task is None:
        return
    for key, value in fields.items():
        setattr(task, key, value)
    await session.commit()


async def update_from_upstream(
    session: AsyncSession, task_id: uuid.UUID, upstream_status: dict
) -> str | None:
    """Mirror upstream status onto the task.

    Returns the cache_dir to release when the task has just reached a terminal
    state (staged files are no longer needed, §3.4); otherwise None.
    """
    task = await session.get(TaskRecord, task_id)
    if task is None:
        return None
    raw = (upstream_status.get("status") or "").lower()
    mapped = _UPSTREAM_STATUS_MAP.get(raw, task.status)

    now = datetime.now(timezone.utc)
    if mapped == "processing" and task.started_at is None:
        task.started_at = now
    if mapped in TERMINAL_STATES and task.completed_at is None:
        task.completed_at = now
    if mapped == "failed":
        task.upstream_error = upstream_status.get("error") or task.upstream_error

    task.status = mapped
    task.consecutive_poll_failures = 0

    released: str | None = None
    if mapped in TERMINAL_STATES and task.cache_dir:
        released = task.cache_dir
        task.cache_dir = None

    await session.commit()
    return released


async def mark_retryable(session: AsyncSession, task_id: uuid.UUID) -> None:
    """Flag a crashed task for resubmission, only if its cache is still present."""
    task = await session.get(TaskRecord, task_id)
    if task is None or task.status in TERMINAL_STATES:
        return
    if not task.cache_dir:
        # No staged files → cannot resubmit; leave as-is for status sync.
        return
    task.status = "retry_pending"
    await session.commit()


async def mark_failed(session: AsyncSession, task_id: uuid.UUID, error: str) -> None:
    task = await session.get(TaskRecord, task_id)
    if task is None:
        return
    task.status = "failed"
    task.error_message = error
    task.completed_at = datetime.now(timezone.utc)
    # Staged files are released by the caller; clear the pointer.
    task.cache_dir = None
    await session.commit()


async def delete_expired(session: AsyncSession, retention_days: int) -> list[str]:
    """Delete task records older than retention. Returns their cache_dirs."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    result = await session.execute(
        select(TaskRecord).where(TaskRecord.created_at < cutoff)
    )
    expired = list(result.scalars().all())
    cache_dirs = [t.cache_dir for t in expired if t.cache_dir]
    for task in expired:
        await session.delete(task)
    await session.commit()
    return cache_dirs
