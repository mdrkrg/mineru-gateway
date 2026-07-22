"""Pydantic schemas for task management (§5.3)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TaskListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    task_id: uuid.UUID
    status: str
    backend: str
    file_names: list[str]
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None
    retry_count: int
    queued_ahead: int | None = None


class TaskListResponse(BaseModel):
    items: list[TaskListItem]
    total: int
    page: int
    page_size: int


class TaskDetail(BaseModel):
    task_id: uuid.UUID
    status: str
    backend: str
    file_names: list[str]
    file_count: int
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None
    retry_count: int
    queued_ahead: int | None = None


class TaskCancelResponse(BaseModel):
    task_id: uuid.UUID
    status: str
    message: str
