"""Pydantic schemas for task management (§5.3)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TaskListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    task_id: uuid.UUID
    status: str
    tier: str | None = None
    file_names: list[str]
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None
    retry_count: int
    has_result: bool = False


class TaskListResponse(BaseModel):
    items: list[TaskListItem]
    total: int
    page: int
    page_size: int


class TaskDetail(BaseModel):
    task_id: uuid.UUID
    status: str
    tier: str | None = None
    file_names: list[str]
    file_count: int
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None
    retry_count: int
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
    partial: int = 0
    failed: int
    cancelled: int
    today_completed: int
    today_failed: int
    total_bytes: int
    avg_duration_ms: float | None = None


class _BatchTaskRequest(BaseModel):
    task_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)

    @field_validator("task_ids")
    @classmethod
    def _task_ids_must_be_unique(cls, task_ids: list[uuid.UUID]) -> list[uuid.UUID]:
        if len(task_ids) != len(set(task_ids)):
            raise ValueError("task_ids must not contain duplicates")
        return task_ids


class ResultZipRequest(_BatchTaskRequest):
    pass


class NonDownloadableItem(BaseModel):
    task_id: uuid.UUID
    status: str
    reason: str


class NonDownloadableError(BaseModel):
    detail: str
    non_downloadable: list[NonDownloadableItem]


class BatchCancelRequest(_BatchTaskRequest):
    pass


class BatchCancelError(BaseModel):
    task_id: uuid.UUID
    reason: str
    current_status: str | None = None


class BatchCancelResponse(BaseModel):
    cancelled_count: int
    cancelled_ids: list[uuid.UUID]
    errors: list[BatchCancelError]
