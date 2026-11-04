"""Admin-plane routes: owner provisioning and API-key management.

Every route here requires ``X-Admin-Token`` and is registered regardless of
``GATEWAY_USER_AUTH_ENABLED``: provisioning an owner is how a key-only
deployment bootstraps, and it does not expose the login stack.

Spec: specs/task-ownership.md §3.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from ..schemas import ApiKeyCreate, ApiKeyCreated, ApiKeyInfo, ApiKeyList
from . import provisioning, service
from .dependencies import get_session, get_settings_dep, require_admin_token
from .manager import UserManager, get_user_manager
from .schemas import AdminUserCreate, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


# ===== Owner provisioning =====


@router.post(
    "/users",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_token)],
)
async def create_owner(
    body: AdminUserCreate,
    request: Request,
    user_manager: Annotated[UserManager, Depends(get_user_manager)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> UserRead:
    """Provision a task owner (201), with or without login credentials."""
    return await provisioning.provision_owner(body, request, user_manager, settings)


# ===== API Key management =====


@router.post(
    "/keys",
    response_model=ApiKeyCreated,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_token)],
)
async def create_key(
    body: ApiKeyCreate,
    session: AsyncSession = Depends(get_session),
) -> ApiKeyCreated:
    """Issue a key for an existing user (admin acts on the owner's behalf)."""
    owner = await service.find_user_by_email(session, body.email)
    if owner is None:
        raise HTTPException(status_code=404, detail="Unknown user")
    if not owner.is_active:
        raise HTTPException(status_code=409, detail="Owner is inactive")
    record, raw = await service.create_key(
        session, owner.id, label=body.label, expires_at=body.expires_at
    )
    return ApiKeyCreated(
        key_id=record.id,
        api_key=raw,
        api_key_prefix=record.key_prefix,
        owner_id=owner.id,
        owner_email=owner.email,
    )


@router.get(
    "/keys",
    response_model=ApiKeyList,
    dependencies=[Depends(require_admin_token)],
)
async def list_keys(session: AsyncSession = Depends(get_session)) -> ApiKeyList:
    records = await service.list_keys_with_owners(session)
    return ApiKeyList(
        keys=[
            ApiKeyInfo(
                id=key.id,
                owner_id=key.owner_id,
                owner_email=email,
                api_key_prefix=key.key_prefix,
                label=key.label,
                created_at=key.created_at,
                last_used_at=key.last_used_at,
                expires_at=key.expires_at,
                is_active=key.is_active,
            )
            for key, email in records
        ]
    )


@router.delete(
    "/keys/{key_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin_token)],
)
async def revoke_key(
    key_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> Response:
    await service.revoke_key(session, key_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
