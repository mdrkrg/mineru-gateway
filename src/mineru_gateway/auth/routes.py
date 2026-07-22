"""API Key management routes (require X-Admin-Token)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..schemas import ApiKeyCreate, ApiKeyCreated, ApiKeyInfo, ApiKeyList
from . import service
from .dependencies import get_session, require_admin_token

router = APIRouter(prefix="/auth/keys", tags=["auth"])


@router.post(
    "",
    response_model=ApiKeyCreated,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_token)],
)
async def create_key(
    body: ApiKeyCreate,
    session: AsyncSession = Depends(get_session),
) -> ApiKeyCreated:
    record, raw = await service.create_key(
        session, label=body.label, expires_at=body.expires_at
    )
    return ApiKeyCreated(
        key_id=record.id,
        api_key=raw,
        api_key_prefix=record.key_prefix,
    )


@router.get(
    "",
    response_model=ApiKeyList,
    dependencies=[Depends(require_admin_token)],
)
async def list_keys(session: AsyncSession = Depends(get_session)) -> ApiKeyList:
    records = await service.list_keys(session)
    return ApiKeyList(
        keys=[
            ApiKeyInfo(
                id=r.id,
                prefix=r.key_prefix,
                label=r.label,
                created_at=r.created_at,
                last_used_at=r.last_used_at,
                expires_at=r.expires_at,
                is_active=r.is_active,
            )
            for r in records
        ]
    )


@router.delete(
    "/{key_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin_token)],
)
async def revoke_key(
    key_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> Response:
    await service.revoke_key(session, key_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
