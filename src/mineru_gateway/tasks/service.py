"""Task metadata CRUD + ownership checks."""

from __future__ import annotations

from typing import Any

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
