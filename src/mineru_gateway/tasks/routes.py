"""Task management routes.

Phase 1: stubbed (501). Full implementation lands in Phase 2.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..auth.dependencies import require_api_key
from ..models import ApiKey

router = APIRouter(prefix="/tasks", tags=["tasks"])

_NOT_IMPLEMENTED = "Not implemented in Phase 1 (see plans/mvp-implementation-plan.md Phase 2)"


@router.get("")
async def list_tasks(api_key: ApiKey | None = Depends(require_api_key)):
    raise HTTPException(status_code=501, detail=_NOT_IMPLEMENTED)


@router.get("/{task_id}")
async def get_task(task_id: str, api_key: ApiKey | None = Depends(require_api_key)):
    raise HTTPException(status_code=501, detail=_NOT_IMPLEMENTED)


@router.get("/{task_id}/result")
async def get_task_result(
    task_id: str, api_key: ApiKey | None = Depends(require_api_key)
):
    raise HTTPException(status_code=501, detail=_NOT_IMPLEMENTED)


@router.delete("/{task_id}")
async def cancel_task(task_id: str, api_key: ApiKey | None = Depends(require_api_key)):
    raise HTTPException(status_code=501, detail=_NOT_IMPLEMENTED)
