"""Task management routes (Phase 2): list, detail, result, cancel.

Spec: mvp-implementation.md §3.2, §5.1, §5.3. All endpoints require X-API-Key
and enforce per-key ownership (§3.3).
Also batch-endpoints.md: POST /v1/tasks/result-zip, POST /v1/tasks/cancel.
"""

from __future__ import annotations

import io
import json
import logging
import mimetypes
import re
import uuid
import zipfile
from datetime import date
from email.message import Message
from typing import Any, Literal
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import get_session, require_api_key
from ..models import ApiKey, TaskRecord
from ..upstream.client import UpstreamClient
from ..upstream.response import relay_headers, relay_response
from . import service
from .cache import FileCache
from .schemas import (
    BatchCancelError,
    BatchCancelRequest,
    BatchCancelResponse,
    NonDownloadableError,
    NonDownloadableItem,
    ResultZipRequest,
    TaskCancelResponse,
    TaskDetail,
    TaskListItem,
    TaskListResponse,
    TaskStatsResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/tasks", tags=["tasks"])


async def _upstream(request: Request) -> UpstreamClient:
    return request.app.state.upstream


async def _cache(request: Request) -> FileCache:
    return request.app.state.file_cache


def _require_key(api_key: ApiKey | None) -> ApiKey:
    # Gateway-owned list, stats, and batch operations always require an owner.
    if api_key is None:
        raise HTTPException(status_code=401, detail="API key required")
    return api_key


def _local_task_id(task_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc


def _requested_output_formats(task: TaskRecord) -> list[str]:
    """Artifact formats recorded at submission time."""
    return task.parse_params.get("output_formats", [])


async def _cancel_upstream_best_effort(
    upstream: UpstreamClient, task: TaskRecord
) -> None:
    if not task.upstream_task_id:
        return
    try:
        await upstream.cancel_task(task.upstream_task_id)
    except Exception as exc:
        logger.warning(
            "Upstream cancellation failed for task %s: %s",
            task.id,
            exc,
            extra={
                "task_id": str(task.id),
                "upstream_task_id": task.upstream_task_id,
            },
        )


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    status: str | None = None,
    tier: str | None = None,
    file_name: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    has_result: bool | None = None,
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
        tier=tier,
        file_name=file_name,
        date_from=date_from,
        date_to=date_to,
        has_result=has_result,
        page=page,
        page_size=page_size,
    )
    items = [
        TaskListItem(
            task_id=t.id,
            status=t.status,
            tier=t.tier,
            file_names=t.file_names or [],
            created_at=t.created_at,
            started_at=t.started_at,
            completed_at=t.completed_at,
            error=t.error_message or t.upstream_error,
            retry_count=t.retry_count,
            has_result=service.task_has_result(t),
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
    task_id: str,
    api_key: ApiKey | None = Depends(require_api_key),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
) -> TaskDetail | Response:
    if api_key is None:
        return relay_response(await upstream.get_task_status(task_id))
    key = _require_key(api_key)
    task = await service.get_owned(session, _local_task_id(task_id), key.id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskDetail(
        task_id=task.id,
        status=task.status,
        tier=task.tier,
        file_names=task.file_names or [],
        file_count=task.file_count,
        created_at=task.created_at,
        started_at=task.started_at,
        completed_at=task.completed_at,
        error=task.error_message or task.upstream_error,
        retry_count=task.retry_count,
        has_result=service.task_has_result(task),
    )


@router.get("/{task_id}/result")
async def get_task_result(
    task_id: str,
    response_format: Literal["json", "zip"] | None = None,
    api_key: ApiKey | None = Depends(require_api_key),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
) -> Response:
    if api_key is None:
        return relay_response(
            await upstream.get_task_result(task_id, response_format=response_format)
        )
    key = _require_key(api_key)
    task = await service.get_owned(session, _local_task_id(task_id), key.id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status not in service.TERMINAL_STATES:
        raise HTTPException(
            status_code=409,
            detail=f"Task result not yet available (status={task.status})",
        )
    # Cancelled tasks, and terminal tasks without an upstream id,
    # are not downloadable.
    if not service.task_has_result(task):
        raise HTTPException(
            status_code=409,
            detail=f"Task has no upstream result (status={task.status})",
        )

    # A task submitted with `zip` defaults to the ZIP download; otherwise the
    # upstream inline JSON result is relayed unchanged.
    effective_response_format = response_format
    if effective_response_format is None and "zip" in _requested_output_formats(task):
        effective_response_format = "zip"

    upstream_resp = await upstream.get_task_result(
        task.upstream_task_id,
        response_format=effective_response_format,
    )
    headers = relay_headers(upstream_resp)
    # UX: name the download after the user's original file instead of the
    # upstream task UUID. Only download-like responses are rewritten; JSON
    # results and tasks without file_names pass through unchanged.
    disposition = _build_download_disposition(task, upstream_resp.headers)
    if disposition:
        for k in [k for k in headers if k.lower() == "content-disposition"]:
            del headers[k]
        headers["Content-Disposition"] = disposition
    return Response(
        content=upstream_resp.content,
        status_code=upstream_resp.status_code,
        headers=headers,
        media_type=upstream_resp.headers.get("content-type"),
    )


@router.delete("/{task_id}", response_model=TaskCancelResponse)
async def cancel_task(
    task_id: str,
    api_key: ApiKey | None = Depends(require_api_key),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
    cache: FileCache = Depends(_cache),
) -> TaskCancelResponse | Response:
    if api_key is None:
        return relay_response(await upstream.cancel_task(task_id))
    key = _require_key(api_key)
    task = await service.get_owned(session, _local_task_id(task_id), key.id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status not in service.CANCELLABLE_STATES:
        raise HTTPException(
            status_code=409,
            detail=f"Only pending or processing tasks can be cancelled "
            f"(status={task.status})",
        )

    # Best-effort: forward cancellation to upstream if reachable.
    await _cancel_upstream_best_effort(upstream, task)

    released = await service.mark_cancelled(session, task)
    # Staged files are no longer needed once the task is terminal (§3.4).
    await cache.release(released)
    return TaskCancelResponse(
        task_id=task.id, status="cancelled", message="Task cancelled"
    )


@router.post("/result-zip", responses={409: {"model": NonDownloadableError}})
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

    non_downloadable: list[NonDownloadableItem] = []
    for task_id in body.task_ids:
        task = tasks_by_id[task_id]
        if service.task_has_result(task):
            continue
        reason = (
            "missing_upstream_task_id"
            if task.status in service.RESULT_STATES
            else "not_completed"
        )
        non_downloadable.append(
            NonDownloadableItem(
                task_id=task_id,
                status=task.status,
                reason=reason,
            )
        )

    if non_downloadable:
        return JSONResponse(
            status_code=409,
            content=NonDownloadableError(
                detail="One or more tasks are not available for download",
                non_downloadable=non_downloadable,
            ).model_dump(mode="json"),
        )

    included: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    used_names: set[str] = set()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for task_id in body.task_ids:
            task = tasks_by_id[task_id]
            upstream_task_id: str = task.upstream_task_id  # type: ignore[assignment]

            # MinerU only serves a ZIP result when the task was submitted with
            # `zip` in `output_formats`. Tasks submitted without it still get
            # packed here from their inline JSON result.
            response_format = (
                "zip" if "zip" in _requested_output_formats(task) else "json"
            )
            try:
                upstream_resp = await upstream.get_task_result(
                    upstream_task_id, response_format=response_format
                )
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
            if entry in used_names:
                suffix = str(task_id).split("-")[-1][:8]
                base, dot_ext = _split_ext(entry)
                entry = f"{base}-{suffix}{dot_ext}"
            used_names.add(entry)
            zf.writestr(entry, upstream_resp.content)
            included.append({"task_id": str(task_id), "entry": entry})

        manifest = {"included": included, "skipped": skipped}
        zf.writestr("_manifest.json", json.dumps(manifest, indent=2))

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="results.zip"'},
    )


_DOWNLOAD_MIME_PREFIXES = ("application/zip", "application/octet-stream")
_PASSTHROUGH_MIME_PREFIXES = ("application/json", "text/")
_UNSAFE_FILENAME_CHARS = re.compile(r'[\x00-\x1f\x7f"\\/:*?<>|]')
_STEM_MAX_LENGTH = 100


def _build_download_disposition(task: Any, upstream_headers: Any) -> str | None:
    """Content-Disposition named after the user's original file, or None.

    Mirrors the batch-endpoints.md entry naming (file_names[0] first),
    adapted for a single attachment download. Returns None to keep the
    upstream header as-is when the response is not a download or the task
    has no file metadata.
    """
    content_type = (upstream_headers.get("content-type") or "").lower()
    disposition = upstream_headers.get("content-disposition") or ""
    bare_type = content_type.split(";")[0].strip()

    if bare_type.startswith(_PASSTHROUGH_MIME_PREFIXES):
        return None
    is_download = bool(disposition) or bare_type.startswith(_DOWNLOAD_MIME_PREFIXES)
    if not is_download or not task.file_names:
        return None

    stem = _sanitize_stem(task.file_names[0])
    if not stem:
        return None
    filename = f"{stem}{_download_extension(disposition, content_type)}"

    try:
        filename.encode("ascii")
        return f'attachment; filename="{filename}"'
    except UnicodeEncodeError:
        # RFC 6266/5987: percent-encoded ASCII fallback + UTF-8 form for
        # non-ASCII names (frontend prefers filename* when present).
        encoded = quote(filename, safe="")
        return f"attachment; filename=\"{encoded}\"; filename*=UTF-8''{encoded}"


def _strip_extension(name: str) -> str:
    """Drop the extension ('doc.pdf' -> 'doc'); dotfiles ('.pdf') keep their name."""
    dot = name.rfind(".")
    return name[:dot] if dot > 0 else name


def _sanitize_stem(name: str) -> str:
    """basename -> extensionless stem, safe for headers and local filesystems."""
    base = _strip_extension(name.replace("\\", "/").split("/")[-1])
    stem = _UNSAFE_FILENAME_CHARS.sub("_", base).strip().strip(".")
    return stem[:_STEM_MAX_LENGTH]


def _sanitize_entry_name(name: str) -> str:
    """Sanitize an upstream filename for use as a zip entry.

    Strips directories and unsafe characters (zip-slip), keeping the
    extension. Returns "" when nothing safe remains.
    """
    base = name.replace("\\", "/").split("/")[-1]
    base = _UNSAFE_FILENAME_CHARS.sub("_", base).strip().strip(".")
    return base[: _STEM_MAX_LENGTH + 16]


def _download_extension(disposition: str, content_type: str) -> str:
    """Extension from the upstream filename when present, else Content-Type."""
    upstream_name = _extract_cd_filename(disposition)
    if upstream_name:
        _, ext = _split_ext(upstream_name)
        if 0 < len(ext) <= 8:
            return ext
    return _guess_extension(content_type)


_FILENAME_STAR_RE = re.compile(
    r"filename\*\s*=\s*([^';\s]+)'[^']*'([^;]+)", re.IGNORECASE
)
_FILENAME_RE = re.compile(
    r"""filename\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s"']+))""", re.IGNORECASE
)


def _extract_cd_filename(content_disposition: str) -> str | None:
    """Extract filename from Content-Disposition, preferring RFC 5987 filename*."""
    if not content_disposition:
        return None
    match = _FILENAME_STAR_RE.search(content_disposition)
    if match:
        charset, encoded = match.group(1).strip('"'), match.group(2).strip('"')
        try:
            return unquote(encoded, encoding=charset)
        except LookupError:
            return unquote(encoded)
    match = _FILENAME_RE.search(content_disposition)
    if match:
        return next(value for value in match.groups() if value is not None)
    # RFC 2231 continuations (filename*0*/filename*1*) and non-conforming values.
    msg = Message()
    msg["content-disposition"] = content_disposition
    return msg.get_filename() or None


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
        base = _sanitize_stem(task.file_names[0])
        if base:
            return f"{base}/result.bin"
    return f"{task.id}/result.bin"


def _build_result_entry_name(task: Any, upstream_resp: Any) -> str:
    """Build zip entry name from task metadata and upstream response.

    Priority (spec step 6):
    a. sanitized Content-Disposition filename from upstream
    b. sanitized file_names[0] stem /result.<extension>
    c. task_id / result.<extension>
    d. .bin fallback
    """
    cd_filename = _extract_cd_filename(
        upstream_resp.headers.get("content-disposition", "")
    )
    if cd_filename:
        safe = _sanitize_entry_name(cd_filename)
        if safe:
            return safe

    ext = _guess_extension(upstream_resp.headers.get("content-type"))

    if task.file_names and len(task.file_names) > 0:
        base = _sanitize_stem(task.file_names[0])
        if base:
            return f"{base}/result{ext}"

    return f"{task.id}/result{ext}"


def _split_ext(name: str) -> tuple[str, str]:
    """Split a filename into (base, extension)."""
    dot = name.rfind(".")
    if dot < 0:
        return name, ""
    return name[:dot], name[dot:]


@router.post(
    "/cancel", response_model=BatchCancelResponse, response_model_exclude_none=True
)
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

        if task.status not in service.CANCELLABLE_STATES:
            errors.append(
                BatchCancelError(
                    task_id=task_id,
                    reason="not_cancellable",
                    current_status=task.status,
                )
            )
            continue

        await _cancel_upstream_best_effort(upstream, task)

        released = await service.mark_cancelled(session, task)
        await cache.release(released)
        cancelled_ids.append(task_id)

    return BatchCancelResponse(
        cancelled_count=len(cancelled_ids),
        cancelled_ids=cancelled_ids,
        errors=errors,
    )
