"""Task management routes (Phase 2): list, detail, result, cancel.

Spec: mvp-implementation.md §3.2, §5.1, §5.3; task-ownership.md.
Task endpoints accept X-API-Key or a Bearer JWT and enforce owner-based
access: every credential resolves to one owner, and only that owner's tasks
are visible.
Also batch-endpoints.md: POST /v1/tasks/result-zip, POST /v1/tasks/cancel.
"""

from __future__ import annotations

import io
import json
import logging
import mimetypes
import posixpath
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
from starlette.datastructures import MutableHeaders

from ..auth.dependencies import get_session, require_task_principal
from ..auth.principals import TaskPrincipal
from ..models import TaskRecord
from ..upstream.client import UpstreamClient
from ..upstream.params import INLINE_OUTPUT_FORMATS, OutputFormat
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


def _require_owner(principal: TaskPrincipal | None) -> uuid.UUID:
    # Gateway-owned list, stats, and batch operations always require a
    # credential; anonymous callers only get upstream passthrough.
    if principal is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return principal.owner_id


def _local_task_id(task_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc


def _requested_output_formats(task: TaskRecord) -> list[str]:
    """Artifact formats recorded at submission time."""
    return task.parse_params.get("output_formats", [])


def _result_format_for(task: TaskRecord) -> Literal["zip", "json"]:
    """Response format matching the artifacts recorded at submission."""
    return "zip" if "zip" in _requested_output_formats(task) else "json"


async def _require_downloadable_task(
    session: AsyncSession, owner_id: uuid.UUID, task_id: str
) -> TaskRecord:
    """Ownership plus terminal-state guards shared by result downloads."""
    task = await service.get_in_scope(session, _local_task_id(task_id), owner_id)
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
    return task


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
    principal: TaskPrincipal | None = Depends(require_task_principal),
    session: AsyncSession = Depends(get_session),
) -> TaskListResponse:
    owner_id = _require_owner(principal)
    tasks, total = await service.list_tasks(
        session,
        owner_id,
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
    principal: TaskPrincipal | None = Depends(require_task_principal),
    session: AsyncSession = Depends(get_session),
) -> TaskStatsResponse:
    owner_id = _require_owner(principal)
    stats = await service.get_stats(session, owner_id)
    return TaskStatsResponse(**stats)


@router.get("/{task_id}", response_model=TaskDetail)
async def get_task(
    task_id: str,
    principal: TaskPrincipal | None = Depends(require_task_principal),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
) -> TaskDetail | Response:
    if principal is None:
        return relay_response(await upstream.get_task_status(task_id))
    owner_id = _require_owner(principal)
    task = await service.get_in_scope(session, _local_task_id(task_id), owner_id)
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
    principal: TaskPrincipal | None = Depends(require_task_principal),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
) -> Response:
    if principal is None:
        return relay_response(
            await upstream.get_task_result(task_id, response_format=response_format)
        )
    task = await _require_downloadable_task(session, _require_owner(principal), task_id)

    # A task submitted with `zip` defaults to the ZIP result; otherwise the
    # native JSON result is relayed, with `response_format` as the escape hatch.
    effective_response_format = response_format or _result_format_for(task)

    upstream_resp = await upstream.get_task_result(
        task.upstream_task_id,
        response_format=effective_response_format,
    )
    return _relayed_result(task, upstream_resp)


@router.get("/{task_id}/download")
async def download_task_result(
    task_id: str,
    principal: TaskPrincipal | None = Depends(require_task_principal),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
) -> Response:
    """Download the artifacts requested at submission, as files.

    ZIP submissions relay the upstream archive. Plain-format submissions only
    carry their artifacts inline in the JSON result, so the gateway rebuilds
    them: a single artifact is returned directly, several are packed into a
    ZIP. Errors and unknown payloads fall back to the relayed response.
    """
    task = await _require_downloadable_task(session, _require_owner(principal), task_id)
    response_format = _result_format_for(task)
    upstream_resp = await upstream.get_task_result(
        task.upstream_task_id, response_format=response_format
    )
    if upstream_resp.status_code == 200 and response_format == "json":
        artifacts = _inline_artifacts(task, upstream_resp)
        if artifacts:
            return _artifact_response(task, artifacts)
        # Silent fallbacks would hand back the task envelope this endpoint
        # exists to replace, so leave a trace for upstream contract drift.
        logger.warning(
            "No inline artifacts for task %s; relaying the upstream result",
            task.id,
            extra={
                "task_id": str(task.id),
                "content_type": upstream_resp.headers.get("content-type"),
            },
        )
    return _relayed_result(task, upstream_resp)


def _relayed_result(task: TaskRecord, upstream_resp: Any) -> Response:
    """Relay an upstream result, naming successful downloads after the file."""
    headers = MutableHeaders(headers=relay_headers(upstream_resp))
    disposition = (
        _build_download_disposition(task, upstream_resp.headers)
        if upstream_resp.status_code == 200
        else None
    )
    if disposition:
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
    principal: TaskPrincipal | None = Depends(require_task_principal),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
    cache: FileCache = Depends(_cache),
) -> TaskCancelResponse | Response:
    if principal is None:
        return relay_response(await upstream.cancel_task(task_id))
    owner_id = _require_owner(principal)
    task = await service.get_in_scope(session, _local_task_id(task_id), owner_id)
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
    principal: TaskPrincipal | None = Depends(require_task_principal),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
) -> Response:
    owner_id = _require_owner(principal)

    tasks_by_id: dict[uuid.UUID, TaskRecord] = {}
    for task_id in body.task_ids:
        task = await service.get_in_scope(session, task_id, owner_id)
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

            # Native ZIP when requested, otherwise the inline JSON result.
            response_format = _result_format_for(task)
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

            artifacts = _inline_artifacts(task, upstream_resp)
            if artifacts:
                entries = _write_artifacts(zf, artifacts, used_names, task_id)
                included.extend(
                    {"task_id": str(task_id), "entry": entry} for entry in entries
                )
                continue

            entry = _unique_entry(
                _build_result_entry_name(task, upstream_resp), used_names, task_id
            )
            zf.writestr(entry, upstream_resp.content)
            included.append({"task_id": str(task_id), "entry": entry})

        manifest = {"included": included, "skipped": skipped}
        zf.writestr("_manifest.json", json.dumps(manifest, indent=2))

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="results.zip"'},
    )


_UNSAFE_FILENAME_CHARS = re.compile(r'[\x00-\x1f\x7f"\\/:*?<>|]')
_STEM_MAX_LENGTH = 100


def _build_download_disposition(task: Any, upstream_headers: Any) -> str | None:
    """Content-Disposition named after the user's original file, or None.

    Mirrors the batch-endpoints.md entry naming (file_names[0] first),
    adapted for a single attachment download: every successful body is named,
    JSON and text included. Returns None when the task has no file metadata.
    """
    stem = _stem_at(task)
    if not stem:
        return None
    disposition = upstream_headers.get("content-disposition") or ""
    content_type = upstream_headers.get("content-type") or ""
    return _content_disposition(
        f"{stem}{_download_extension(disposition, content_type)}"
    )


def _content_disposition(filename: str) -> str:
    """Attachment header for a synthesized download.

    Non-ASCII names use RFC 6266/5987: percent-encoded ASCII fallback plus the
    UTF-8 form (the frontend prefers `filename*` when present).
    """
    if filename.isascii():
        return f'attachment; filename="{filename}"'
    encoded = quote(filename, safe="")
    return f"attachment; filename=\"{encoded}\"; filename*=UTF-8''{encoded}"


def _sanitize_stem(name: str) -> str:
    """basename -> extensionless stem, safe for headers and local filesystems."""
    base = posixpath.splitext(name.replace("\\", "/").split("/")[-1])[0]
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
        _, ext = posixpath.splitext(upstream_name)
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


def _stem_at(task: Any, index: int = 0) -> str | None:
    """Sanitized stem of the index-th submitted file, or None."""
    names = task.file_names or []
    if index >= len(names):
        return None
    return _sanitize_stem(names[index]) or None


def _fallback_entry_name(task: Any) -> str:
    """Build entry name for skipped tasks (rules 6b/6c/6d with .bin fallback)."""
    base = _stem_at(task)
    return f"{base}/result.bin" if base else f"{task.id}/result.bin"


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

    base = _stem_at(task)
    return f"{base}/result{ext}" if base else f"{task.id}/result{ext}"


def _unique_entry(entry: str, used: set[str], task_id: Any) -> str:
    """Disambiguate a zip entry name so writes never overwrite silently."""
    if entry not in used:
        used.add(entry)
        return entry
    base, ext = posixpath.splitext(entry)
    suffix = str(task_id).split("-")[-1][:8]
    candidate = f"{base}-{suffix}{ext}"
    counter = 2
    while candidate in used:
        candidate = f"{base}-{suffix}-{counter}{ext}"
        counter += 1
    used.add(candidate)
    return candidate


def _inline_artifacts(
    task: TaskRecord, upstream_resp: Any
) -> list[tuple[str, OutputFormat, bytes]]:
    """Artifacts inlined in a MinerU JSON result, as (stem, format, bytes).

    MinerU only builds a ZIP when `zip` was requested at submission, so other
    tasks carry the requested formats under `files[].content`. Downloads
    rebuild them as files instead of returning the task envelope.
    """
    content_type = (upstream_resp.headers.get("content-type") or "").lower()
    if not content_type.startswith("application/json"):
        return []
    try:
        payload = upstream_resp.json()
    except ValueError:
        return []
    if not isinstance(payload, dict):
        return []

    formats = [
        OutputFormat(name)
        for name in _requested_output_formats(task)
        if name in INLINE_OUTPUT_FORMATS
    ]
    files = payload.get("files")
    if not formats or not isinstance(files, list):
        return []

    artifacts: list[tuple[str, OutputFormat, bytes]] = []
    for index, entry in enumerate(files):
        if not isinstance(entry, dict):
            continue
        content = entry.get("content")
        if not isinstance(content, dict):
            continue
        stem = _artifact_stem(task, entry, index)
        for fmt in formats:
            value = content.get(fmt)
            if value is None:
                continue
            artifacts.append((stem, fmt, _artifact_bytes(value)))
    return artifacts


def _artifact_stem(task: TaskRecord, entry: dict[str, Any], index: int) -> str:
    """Per-file stem: upstream file name first, then the submitted name."""
    name = entry.get("name")
    stem = _sanitize_stem(name) if isinstance(name, str) and name else ""
    return stem or _stem_at(task, index) or f"{task.id}-{index + 1}"


def _artifact_bytes(value: Any) -> bytes:
    """Artifact payload as bytes; JSON formats may arrive as objects."""
    if isinstance(value, str):
        return value.encode()
    return json.dumps(value, ensure_ascii=False, indent=2).encode()


def _write_artifacts(
    zf: zipfile.ZipFile,
    artifacts: list[tuple[str, OutputFormat, bytes]],
    used: set[str],
    task_id: Any,
) -> list[str]:
    """Write artifacts as `<stem>/<format><ext>` entries; return their names."""
    entries: list[str] = []
    for stem, fmt, data in artifacts:
        entry = _unique_entry(f"{stem}/{fmt}{fmt.extension}", used, task_id)
        zf.writestr(entry, data)
        entries.append(entry)
    return entries


def _artifact_response(
    task: TaskRecord, artifacts: list[tuple[str, OutputFormat, bytes]]
) -> Response:
    """Serve one artifact directly, or several as a ZIP."""
    if len(artifacts) == 1:
        stem, fmt, data = artifacts[0]
        return Response(
            content=data,
            media_type=fmt.media_type,
            headers={
                "Content-Disposition": _content_disposition(f"{stem}{fmt.extension}")
            },
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        _write_artifacts(zf, artifacts, set(), task.id)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": _content_disposition(f"{artifacts[0][0]}.zip")},
    )


@router.post(
    "/cancel", response_model=BatchCancelResponse, response_model_exclude_none=True
)
async def batch_cancel(
    body: BatchCancelRequest,
    principal: TaskPrincipal | None = Depends(require_task_principal),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
    cache: FileCache = Depends(_cache),
) -> BatchCancelResponse:
    owner_id = _require_owner(principal)

    cancelled_ids: list[uuid.UUID] = []
    errors: list[BatchCancelError] = []

    for task_id in body.task_ids:
        task = await service.get_in_scope(session, task_id, owner_id)
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
