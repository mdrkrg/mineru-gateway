"""Self-service API Key routes: /me/api-keys (Section 5.1).

Spec: user-management-and-oauth.md Section 4.4.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import User
from ..schemas import ApiKeyCreated, ApiKeyInfo, ApiKeyList
from . import service
from .dependencies import current_active_user, get_session
from .schemas import MyApiKeyCreate

router = APIRouter(prefix="/me/api-keys", tags=["me"])


@router.get("", response_model=ApiKeyList)
async def list_my_keys(
    user: Annotated[User, Depends(current_active_user)],
    session: AsyncSession = Depends(get_session),
) -> ApiKeyList:
    """Section 4.4: list keys where owner_id == current user."""
    records = await service.list_keys_for_user(session, user.id)
    return ApiKeyList(
        keys=[
            ApiKeyInfo(
                id=r.id,
                api_key_prefix=r.key_prefix,
                label=r.label,
                created_at=r.created_at,
                last_used_at=r.last_used_at,
                expires_at=r.expires_at,
                is_active=r.is_active,
            )
            for r in records
        ]
    )


@router.post(
    "",
    response_model=ApiKeyCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_my_key(
    body: MyApiKeyCreate,
    user: Annotated[User, Depends(current_active_user)],
    session: AsyncSession = Depends(get_session),
) -> ApiKeyCreated:
    """Section 4.4: create key with owner_id = current user."""
    record, raw = await service.create_key_for_user(
        session, user.id, label=body.label, expires_at=body.expires_at
    )
    return ApiKeyCreated(
        key_id=record.id,
        api_key=raw,
        api_key_prefix=record.key_prefix,
    )


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_my_key(
    key_id: uuid.UUID,
    user: Annotated[User, Depends(current_active_user)],
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Section 4.4: revoke own key; 404 if not owner (unified, no enumeration)."""
    ok = await service.revoke_key_for_user(session, key_id, user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="Key not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
