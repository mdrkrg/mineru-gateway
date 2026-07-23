"""Task management routes (Phase 2): list, detail, result, cancel.

Spec: mvp-implementation.md §3.2, §5.1, §5.3. All endpoints require X-API-Key
and enforce per-key ownership (§3.3).
"""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import get_session, require_api_key
from ..models import ApiKey
from ..upstream.client import UpstreamClient
from . import service
from .cache import FileCache
from .schemas import (
    TaskCancelResponse,
    TaskDetail,
    TaskListItem,
    TaskListResponse,
    TaskStatsResponse,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])


async def _upstream(request: Request) -> UpstreamClient:
    return request.app.state.upstream


async def _cache(request: Request) -> FileCache:
    return request.app.state.file_cache


def _require_key(api_key: ApiKey | None) -> ApiKey:
    # Task endpoints are always owner-scoped; anonymous access is meaningless.
    if api_key is None:
        raise HTTPException(status_code=401, detail="API key required")
    return api_key


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    status: str | None = None,
    backend: str | None = None,
    file_name: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    api_key: ApiKey | None = Depends(require_api_key),
    session: AsyncSession = Depends(get_session),
) -> TaskListResponse:
    key = _require_key(api_key)
    tasks, total = await service.list_tasks(
        session,
        key.id,
        status=status,
        backend=backend,
        file_name=file_name,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )
    items = [
        TaskListItem(
            task_id=t.id,
            status=t.status,
            backend=t.backend,
            file_names=t.file_names or [],
            created_at=t.created_at,
            started_at=t.started_at,
            completed_at=t.completed_at,
            error=t.error_message,
            retry_count=t.retry_count,
            queued_ahead=t.queued_ahead,
        )
        for t in tasks
    ]
    return TaskListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/stats", response_model=TaskStatsResponse)
async def task_stats(
    api_key: ApiKey | None = Depends(require_api_key),
    session: AsyncSession = Depends(get_session),
) -> TaskStatsResponse:
    key = _require_key(api_key)
    stats = await service.get_stats(session, key.id)
    return TaskStatsResponse(**stats)


@router.get("/{task_id}", response_model=TaskDetail)
async def get_task(
    task_id: uuid.UUID,
    api_key: ApiKey | None = Depends(require_api_key),
    session: AsyncSession = Depends(get_session),
) -> TaskDetail:
    key = _require_key(api_key)
    task = await service.get_owned(session, task_id, key.id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskDetail(
        task_id=task.id,
        status=task.status,
        backend=task.backend,
        file_names=task.file_names or [],
        file_count=task.file_count,
        created_at=task.created_at,
        started_at=task.started_at,
        completed_at=task.completed_at,
        error=task.error_message,
        retry_count=task.retry_count,
        queued_ahead=task.queued_ahead,
    )


@router.get("/{task_id}/result")
async def get_task_result(
    task_id: uuid.UUID,
    api_key: ApiKey | None = Depends(require_api_key),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
) -> Response:
    key = _require_key(api_key)
    task = await service.get_owned(session, task_id, key.id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if not task.upstream_task_id:
        raise HTTPException(status_code=409, detail="Task has no upstream result yet")
    if task.status not in ("completed", "failed", "cancelled"):
        raise HTTPException(status_code=409, detail="Task result not yet available")

    upstream_resp = await upstream.get_task_result(task.upstream_task_id)
    excluded = {"content-length", "content-encoding", "transfer-encoding", "connection"}
    headers = {
        k: v for k, v in upstream_resp.headers.items() if k.lower() not in excluded
    }
    return Response(
        content=upstream_resp.content,
        status_code=upstream_resp.status_code,
        headers=headers,
        media_type=upstream_resp.headers.get("content-type"),
    )


@router.delete("/{task_id}", response_model=TaskCancelResponse)
async def cancel_task(
    task_id: uuid.UUID,
    api_key: ApiKey | None = Depends(require_api_key),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
    cache: FileCache = Depends(_cache),
) -> TaskCancelResponse:
    key = _require_key(api_key)
    task = await service.get_owned(session, task_id, key.id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Only pending tasks can be cancelled (status={task.status})",
        )

    # Best-effort: forward cancellation to upstream if reachable.
    if task.upstream_task_id:
        try:
            await upstream.cancel_task(task.upstream_task_id)
        except Exception:
            pass

    released = await service.mark_cancelled(session, task)
    # Staged files are no longer needed once the task is terminal (§3.4).
    await cache.release(released)
    return TaskCancelResponse(
        task_id=task.id, status="cancelled", message="Task cancelled"
    )
