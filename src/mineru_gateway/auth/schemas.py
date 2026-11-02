"""Pydantic schemas for user management and OAuth (Section 5.1).

Spec: user-management-and-oauth.md Section 4 (API responses), Section 5.1.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi_users import schemas
from pydantic import BaseModel, EmailStr


# ===== User schemas (Section 4.2, 4.3) =====


class UserRead(schemas.BaseUser[uuid.UUID]):
    """Section 4.2: registration / user info response body."""

    display_name: str | None = None
    created_at: datetime
    updated_at: datetime


class UserCreate(schemas.BaseUserCreate):
    """Section 4.2: registration / admin-create request body."""

    display_name: str | None = None


class UserUpdate(schemas.BaseUserUpdate):
    """Section 4.3: PATCH /users/me request body.

    email is not mutable via this endpoint (Section 4.3).
    """

    display_name: str | None = None


class AdminUserCreate(BaseModel):
    """Admin-plane request body for provisioning a task owner.

    Omitting ``password`` creates a credential-only owner: the row owns keys
    and tasks but cannot sign in, because the password is random and never
    returned. Admin-issued keys stay identical to self-service keys; this
    schema only decides whether the owner can also log in.
    """

    email: EmailStr
    password: str | None = None
    display_name: str | None = None
    is_active: bool = True
    is_superuser: bool = False
    # Defaults to True for credential-only owners (no mailbox flow) and to
    # False for login-capable ones, which must verify their address.
    is_verified: bool | None = None


# ===== Token schemas (Section 4.1) =====


class LoginRequest(BaseModel):
    """Section 4.1: login request body (email + password only)."""

    email: str
    password: str


class TokenPair(BaseModel):
    """Section 4.1: login / OAuth callback response (access + refresh)."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AccessTokenResponse(BaseModel):
    """Section 4.1: refresh response (access only)."""

    access_token: str
    token_type: str = "bearer"


class RefreshTokenRequest(BaseModel):
    """Section 4.1: refresh request body."""

    refresh_token: str


# ===== /me/api-keys request schema (Section 4.4) =====


class MyApiKeyCreate(BaseModel):
    """Section 4.4: POST /me/api-keys request body."""

    label: str | None = None
    expires_at: datetime | None = None
