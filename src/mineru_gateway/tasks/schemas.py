"""Pydantic schemas for task management (§5.3)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


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
    has_result: bool = False


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
    has_result: bool = False


class TaskCancelResponse(BaseModel):
    task_id: uuid.UUID
    status: str
    message: str


class TaskStatsResponse(BaseModel):
    pending: int
    processing: int
    retry_pending: int
    completed: int
    failed: int
    cancelled: int
    today_completed: int
    today_failed: int
    total_bytes: int
    avg_duration_ms: float | None = None


class ResultZipRequest(BaseModel):
    task_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)


class NonDownloadableItem(BaseModel):
    task_id: uuid.UUID
    status: str
    reason: str


class NonDownloadableError(BaseModel):
    detail: str
    non_downloadable: list[NonDownloadableItem]


class BatchCancelRequest(BaseModel):
    task_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)


class BatchCancelError(BaseModel):
    task_id: uuid.UUID
    reason: str
    current_status: str | None = None


class BatchCancelResponse(BaseModel):
    cancelled_count: int
    cancelled_ids: list[uuid.UUID]
    errors: list[BatchCancelError]
