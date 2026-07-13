"""Core proxy handlers for POST /tasks and POST /file_parse.

Authenticated `POST /tasks` stages the original multipart to the file cache
(for crash recovery, §6.2/§6.4) before forwarding, records the task with its
cache_dir, and returns the Gateway-flavored response. Anonymous requests are a
pure passthrough. `POST /file_parse` is synchronous and not cached (no async
recovery path).
"""

from __future__ import annotations

from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from ..config import Settings
from ..limiter.memory import MemoryTokenBucket
from ..models import ApiKey
from ..tasks import service as task_service
from ..tasks.cache import FileCache
from ..upstream.client import UpstreamClient
from ..upstream.health import check_free_slot

_BOOL_FIELDS = {
    "formula_enable",
    "table_enable",
    "image_analysis",
    "return_md",
    "return_middle_json",
    "return_model_output",
    "return_content_list",
    "return_images",
    "response_format_zip",
    "return_original_file",
    "client_side_output_generation",
}
_INT_FIELDS = {"start_page_id", "end_page_id"}


_STR_FIELDS = {"parse_method", "effort", "server_url"}
_LIST_FIELDS = {"lang_list"}


def _coerce(name: str, value: str):
    if name in _BOOL_FIELDS:
        return value.lower() in ("1", "true", "yes", "on")
    if name in _INT_FIELDS:
        try:
            return int(value)
        except ValueError:
            return None
    return value


def _parse_params(data: dict) -> dict:
    """Extract known parse parameters from the multipart form into TaskRecord fields."""
    params: dict = {}
    for name in _BOOL_FIELDS | _INT_FIELDS | _STR_FIELDS:
        if name in data:
            params[name] = _coerce(name, data[name])
    for name in _LIST_FIELDS:
        if name in data:
            params[name] = [v for v in data[name].split(",") if v]
    return params


async def _extract_multipart(
    request: Request, max_upload_size: int
) -> tuple[dict, list[tuple[str, tuple[str, bytes, str]]], list[str], int]:
    """Read the incoming multipart form into (data, files, file_names, total_bytes)."""
    form = await request.form()
    data: dict = {}
    files: list[tuple[str, tuple[str, bytes, str]]] = []
    file_names: list[str] = []
    total_bytes = 0

    for field, value in form.multi_items():
        if isinstance(value, UploadFile):
            content = await value.read()
            total_bytes += len(content)
            if len(content) > max_upload_size or total_bytes > max_upload_size:
                raise HTTPException(
                    status_code=413,
                    detail=f"Upload exceeds max size ({max_upload_size} bytes)",
                )
            filename = value.filename or field
            file_names.append(filename)
            files.append(
                (
                    field,
                    (
                        filename,
                        content,
                        value.content_type or "application/octet-stream",
                    ),
                )
            )
        else:
            data[field] = value

    return data, files, file_names, total_bytes


def _relay_response(resp) -> Response:
    """Relay an upstream httpx.Response byte-for-byte."""
    excluded = {"content-length", "content-encoding", "transfer-encoding", "connection"}
    headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=headers,
        media_type=resp.headers.get("content-type"),
    )


async def handle_task_submission(
    request: Request,
    api_key: ApiKey | None,
    session: AsyncSession,
    upstream: UpstreamClient,
    limiter: MemoryTokenBucket,
    cache: FileCache,
    settings: Settings,
) -> Response:
    # Defensive: anonymous only allowed when configured.
    if api_key is None and not settings.allow_anonymous:
        raise HTTPException(status_code=401, detail="API key required")

    if api_key and not await limiter.acquire(str(api_key.id)):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded",
            headers={"Retry-After": "60"},
        )

    await check_free_slot(upstream)

    data, files, file_names, total_bytes = await _extract_multipart(
        request, settings.max_upload_size
    )

    # Anonymous: pure passthrough, no caching, no record.
    if api_key is None:
        upstream_resp = await upstream.submit_task(data, files)
        return _relay_response(upstream_resp)

    # Authenticated: stage the original multipart for crash recovery, then
    # forward. Release the cache if the upstream rejects the submission.
    # Global concurrency cap (§3.5): reject when too many tasks are in flight.
    if settings.max_concurrent_tasks > 0:
        in_flight = await task_service.count_in_flight(session)
        if in_flight >= settings.max_concurrent_tasks:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Global concurrency limit reached "
                    f"({in_flight}/{settings.max_concurrent_tasks})"
                ),
                headers={"Retry-After": "10"},
            )

    cache_dir = await cache.store(data, files)
    upstream_resp = await upstream.submit_task(data, files)
    if upstream_resp.status_code != 202:
        await cache.release(cache_dir)
        raise HTTPException(
            status_code=upstream_resp.status_code, detail=upstream_resp.text
        )
    payload = upstream_resp.json()

    qa = payload.get("queued_ahead")
    queued_ahead: int | None = qa if isinstance(qa, int) else None

    task = await task_service.create(
        session,
        api_key_id=api_key.id,
        status="pending",
        upstream_url=settings.upstream_url,
        upstream_task_id=payload.get("task_id"),
        file_names=payload.get("file_names", file_names),
        file_count=len(file_names),
        file_total_bytes=total_bytes,
        backend=data.get("backend", "hybrid-engine"),
        cache_dir=cache_dir,
        queued_ahead=queued_ahead,
        **_parse_params(data),
    )

    return JSONResponse(
        status_code=202,
        content={
            "task_id": str(task.id),
            "status": "pending",
            "backend": task.backend,
            "file_names": task.file_names,
            "created_at": task.created_at.isoformat(),
            "status_url": f"{settings.gateway_url}/tasks/{task.id}",
            "result_url": f"{settings.gateway_url}/tasks/{task.id}/result",
            "message": "Task submitted successfully",
        },
        headers={
            "X-MinerU-Task-Id": str(task.id),
            "X-MinerU-Task-Status": "pending",
            "X-MinerU-Task-Status-Url": f"{settings.gateway_url}/tasks/{task.id}",
            "X-MinerU-Task-Result-Url": f"{settings.gateway_url}/tasks/{task.id}/result",
        },
    )


async def handle_file_parse(
    request: Request,
    api_key: ApiKey | None,
    session: AsyncSession,
    upstream: UpstreamClient,
    limiter: MemoryTokenBucket,
    settings: Settings,
) -> Response:
    if api_key is None and not settings.allow_anonymous:
        raise HTTPException(status_code=401, detail="API key required")

    if api_key and not await limiter.acquire(str(api_key.id)):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded",
            headers={"Retry-After": "60"},
        )

    await check_free_slot(upstream)

    data, files, file_names, total_bytes = await _extract_multipart(
        request, settings.max_upload_size
    )

    upstream_resp = await upstream.parse_file(data, files)

    # Authenticated: record the (synchronous) task for history/ownership.
    if api_key is not None and upstream_resp.status_code == 200:
        await task_service.create(
            session,
            api_key_id=api_key.id,
            status="completed",
            upstream_url=settings.upstream_url,
            file_names=file_names,
            file_count=len(file_names),
            file_total_bytes=total_bytes,
            backend=data.get("backend", "hybrid-engine"),
            **_parse_params(data),
        )

    return _relay_response(upstream_resp)
