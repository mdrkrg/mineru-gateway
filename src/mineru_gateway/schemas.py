"""Pydantic request/response schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


# ===== API Key management =====


class ApiKeyCreate(BaseModel):
    label: str | None = None
    expires_at: datetime | None = None


class ApiKeyCreated(BaseModel):
    key_id: uuid.UUID
    api_key: str
    api_key_prefix: str
    message: str = "Save this API key. It will not be shown again."


class ApiKeyInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    api_key_prefix: str
    label: str
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime | None = None
    is_active: bool


class ApiKeyList(BaseModel):
    keys: list[ApiKeyInfo]


# ===== Task submission response (authenticated superset) =====


class TaskSubmitResponse(BaseModel):
    task_id: uuid.UUID
    status: str
    backend: str
    file_names: list[str]
    created_at: datetime
    status_url: str
    result_url: str
    message: str = "Task submitted successfully"
