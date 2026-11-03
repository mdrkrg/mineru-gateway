"""Pydantic request/response schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


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
    # Echo the owner so an admin can confirm who received the credential.
    owner_id: uuid.UUID
    owner_email: EmailStr
    message: str = "Save this API key. It will not be shown again."


class ApiKeyInfo(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    owner_email: EmailStr
    api_key_prefix: str
    label: str
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime | None = None
    is_active: bool


class ApiKeyList(BaseModel):
    keys: list[ApiKeyInfo]


# ===== Gateway capabilities =====


class OAuthProviderInfo(BaseModel):
    """Name-only OIDC provider entry: enough to build the authorize link."""

    name: str


class GatewayConfig(BaseModel):
    """Unauthenticated capabilities served by ``GET /v1/config``.

    ``providers`` is empty while the login stack is off, so clients never
    receive an entry they cannot use.
    """

    user_auth_enabled: bool
    providers: list[OAuthProviderInfo]
