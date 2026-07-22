"""Self-service API Key routes: /me/api-keys (Section 5.1).

Spec: user-management-and-oauth.md Section 4.4.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..schemas import ApiKeyCreated, ApiKeyList
from .dependencies import get_session, get_settings_dep
from .schemas import MyApiKeyCreate

router = APIRouter(prefix="/me/api-keys", tags=["me"])


@router.get("", response_model=ApiKeyList)
async def list_my_keys(
    session: AsyncSession = Depends(get_session),
    settings=Depends(get_settings_dep),
) -> ApiKeyList:
    """Section 4.4: list keys where owner_id == current user."""
    raise NotImplementedError


@router.post(
    "",
    response_model=ApiKeyCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_my_key(
    body: MyApiKeyCreate,
    session: AsyncSession = Depends(get_session),
    settings=Depends(get_settings_dep),
) -> ApiKeyCreated:
    """Section 4.4: create key with owner_id = current user."""
    raise NotImplementedError


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_my_key(
    key_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    settings=Depends(get_settings_dep),
) -> Response:
    """Section 4.4: revoke own key; 404 if not owner (unified, no enumeration)."""
    raise NotImplementedError
