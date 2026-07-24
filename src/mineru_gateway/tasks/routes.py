"""Task management routes (Phase 2): list, detail, result, cancel.

Spec: mvp-implementation.md §3.2, §5.1, §5.3. All endpoints require X-API-Key
and enforce per-key ownership (§3.3).
Also batch-endpoints.md: POST /tasks/result-zip, POST /tasks/cancel.
"""

from __future__ import annotations

import io
import json
import mimetypes
import re
import uuid
import zipfile
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import get_session, require_api_key
from ..models import ApiKey, TaskRecord
from ..upstream.client import UpstreamClient
from . import service
from .cache import FileCache
from .schemas import (
    BatchCancelError,
    BatchCancelRequest,
    BatchCancelResponse,
    ResultZipRequest,
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


@router.post("/result-zip")
async def result_zip(
    body: ResultZipRequest,
    api_key: ApiKey | None = Depends(require_api_key),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
) -> Response:
    key = _require_key(api_key)

    tasks_by_id: dict[uuid.UUID, TaskRecord] = {}
    for task_id in body.task_ids:
        task = await service.get_owned(session, task_id, key.id)
        if task is None:
            raise HTTPException(
                status_code=404, detail="Task not found for one or more task_ids"
            )
        tasks_by_id[task.id] = task  # Use the task's uuid, not the request param

    non_downloadable: list[dict[str, Any]] = []
    for task_id in body.task_ids:
        task = tasks_by_id[task_id]
        if task.status != "completed":
            non_downloadable.append(
                {
                    "task_id": str(task_id),
                    "status": task.status,
                    "reason": "not_completed",
                }
            )
        elif not task.upstream_task_id:
            non_downloadable.append(
                {
                    "task_id": str(task_id),
                    "status": task.status,
                    "reason": "missing_upstream_task_id",
                }
            )

    if non_downloadable:
        return JSONResponse(
            status_code=409,
            content={
                "detail": "One or more tasks are not available for download",
                "non_downloadable": non_downloadable,
            },
        )

    included: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for task_id in body.task_ids:
            task = tasks_by_id[task_id]
            upstream_task_id: str = task.upstream_task_id  # type: ignore[assignment]

            try:
                upstream_resp = await upstream.get_task_result(upstream_task_id)
            except Exception as exc:
                skipped.append(
                    {
                        "task_id": str(task_id),
                        "entry": _fallback_entry_name(task),
                        "reason": "upstream_error",
                        "detail": str(exc),
                    }
                )
                continue

            if upstream_resp.status_code != 200:
                skipped.append(
                    {
                        "task_id": str(task_id),
                        "entry": _fallback_entry_name(task),
                        "reason": "upstream_error",
                        "detail": f"HTTP {upstream_resp.status_code}",
                    }
                )
                continue

            entry = _build_result_entry_name(task, upstream_resp)
            zf.writestr(entry, upstream_resp.content)
            included.append({"task_id": str(task_id), "entry": entry})

        manifest = {"included": included, "skipped": skipped}
        zf.writestr("_manifest.json", json.dumps(manifest, indent=2))

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="results.zip"'},
    )


def _extract_cd_filename(content_disposition: str) -> str | None:
    """Extract filename from Content-Disposition header value."""
    if not content_disposition:
        return None
    match = re.search(r'filename[^;=\n]*=["\']?([^"\'\s;]+)["\']?', content_disposition)
    if match:
        return match.group(1)
    return None


def _guess_extension(content_type: str | None) -> str:
    """Guess file extension from Content-Type header."""
    if not content_type:
        return ".bin"
    ext = mimetypes.guess_extension(content_type.split(";")[0].strip())
    if ext is None:
        return ".bin"
    return ext


def _fallback_entry_name(task: Any) -> str:
    """Build entry name for skipped tasks (rules 6b/6c/6d with .bin fallback)."""
    if task.file_names and len(task.file_names) > 0:
        base = task.file_names[0]
        dot = base.rfind(".")
        if dot > 0:
            base = base[:dot]
        return f"{base}/result.bin"
    return f"{task.id}/result.bin"


def _build_result_entry_name(task: Any, upstream_resp: Any) -> str:
    """Build zip entry name from task metadata and upstream response.

    Priority (spec step 6):
    a. Content-Disposition filename from upstream
    b. file_names[0] without ext /result.<extension>
    c. task_id / result.<extension>
    d. .bin fallback
    """
    cd_filename = _extract_cd_filename(
        upstream_resp.headers.get("content-disposition", "")
    )
    if cd_filename:
        return cd_filename

    ext = _guess_extension(upstream_resp.headers.get("content-type"))

    if task.file_names and len(task.file_names) > 0:
        base = task.file_names[0]
        dot = base.rfind(".")
        if dot > 0:
            base = base[:dot]
        return f"{base}/result{ext}"

    return f"{task.id}/result{ext}"


@router.post("/cancel", response_model=BatchCancelResponse)
async def batch_cancel(
    body: BatchCancelRequest,
    api_key: ApiKey | None = Depends(require_api_key),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
    cache: FileCache = Depends(_cache),
) -> BatchCancelResponse:
    key = _require_key(api_key)

    cancelled_ids: list[uuid.UUID] = []
    errors: list[BatchCancelError] = []

    for task_id in body.task_ids:
        task = await service.get_owned(session, task_id, key.id)
        if task is None:
            errors.append(BatchCancelError(task_id=task_id, reason="not_found"))
            continue

        if task.status != "pending":
            errors.append(
                BatchCancelError(
                    task_id=task_id,
                    reason="not_cancellable",
                    current_status=task.status,
                )
            )
            continue

        if task.upstream_task_id:
            try:
                await upstream.cancel_task(task.upstream_task_id)
            except Exception:
                pass

        released = await service.mark_cancelled(session, task)
        await cache.release(released)
        cancelled_ids.append(task_id)

    return BatchCancelResponse(
        cancelled_count=len(cancelled_ids),
        cancelled_ids=cancelled_ids,
        errors=errors,
    )
