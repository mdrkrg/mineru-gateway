"""Pydantic request/response schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr


# ===== API Key management =====


class ApiKeyCreate(BaseModel):
    label: str | None = None
    expires_at: datetime | None = None
    # Every key belongs to a real user, so the admin must name the owner. There
    # is no ownerless/service key variant.
    email: EmailStr


class ApiKeyCreated(BaseModel):
    key_id: uuid.UUID
    api_key: str
    api_key_prefix: str
    message: str = "Save this API key. It will not be shown again."


class ApiKeyInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_id: uuid.UUID
    api_key_prefix: str
    label: str
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime | None = None
    is_active: bool


class ApiKeyList(BaseModel):
    keys: list[ApiKeyInfo]
