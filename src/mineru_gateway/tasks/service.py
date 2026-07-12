"""Task metadata CRUD + ownership checks."""

from __future__ import annotations

from datetime import date, datetime, time, timezone
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


async def get(session: AsyncSession, task_id: str) -> TaskRecord | None:
    return await session.get(TaskRecord, task_id)


async def get_owned(
    session: AsyncSession, task_id: str, api_key_id: str
) -> TaskRecord | None:
    task = await session.get(TaskRecord, task_id)
    if task is None or task.api_key_id != api_key_id:
        return None
    return task


def _build_filters(
    api_key_id: str,
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
    api_key_id: str,
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


async def mark_cancelled(session: AsyncSession, task: TaskRecord) -> TaskRecord:
    task.status = "cancelled"
    task.completed_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(task)
    return task

