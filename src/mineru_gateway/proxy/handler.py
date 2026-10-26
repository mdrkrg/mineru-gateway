"""Core proxy handlers for POST /tasks and POST /file_parse.

Authenticated `POST /tasks` stages the original multipart to the file cache
(for crash recovery, §6.2/§6.4) before forwarding, records the task with its
cache_dir, and returns the Gateway-flavored response. Anonymous requests are a
pure passthrough. `POST /file_parse` is synchronous and not cached (no async
recovery path).
"""

from __future__ import annotations

import logging

from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from ..config import Settings
from ..limiter.memory import MemoryTokenBucket
from ..models import ApiKey
from ..tasks import service as task_service
from ..tasks.cache import FileCache
from ..upstream.client import UpstreamClient
from ..upstream.params import (
    VALID_TIERS,
    parse_v1_params,
    v1_files,
)

logger = logging.getLogger(__name__)

_MAX_FORM_BYTES = 1024 * 1024

_REPEATABLE_FORM_FIELDS = {"output_formats"}


def _store_form_field(data: dict, name: str, value: str) -> None:
    if name not in _REPEATABLE_FORM_FIELDS or name not in data:
        data[name] = value
        return
    existing = data[name]
    if isinstance(existing, list):
        existing.append(value)
    else:
        data[name] = [existing, value]


def _parse_options(
    data: dict, *, sync: bool, include_zip: bool = False
) -> tuple[dict, str | None]:
    """Validate form fields and build V1 query params for one request."""
    try:
        params = parse_v1_params(data, sync=sync, include_zip=include_zip)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return params, params.get("tier")


async def _extract_multipart(
    request: Request, max_upload_size: int, max_file_size: int
) -> tuple[dict, list[tuple[str, tuple[str, bytes, str]]], list[str], int]:
    """Read the incoming multipart form into (data, files, file_names, total_bytes)."""
    form = await request.form()
    data: dict = {}
    files: list[tuple[str, tuple[str, bytes, str]]] = []
    file_names: list[str] = []
    total_bytes = 0

    for field, value in form.multi_items():
        if isinstance(value, UploadFile):
            if field != "files":
                raise HTTPException(
                    status_code=400,
                    detail="Every upload part must be named files",
                )
            content = await value.read()
            if len(content) > max_file_size:
                raise HTTPException(
                    status_code=413,
                    detail=f"File exceeds max size ({max_file_size} bytes)",
                )
            total_bytes += len(content)
            if total_bytes > max_upload_size:
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
            _store_form_field(data, field, value)

    return data, files, file_names, total_bytes


async def _extract_multipart_streaming(
    request: Request, max_upload_size: int, max_file_size: int, cache: FileCache
) -> tuple[dict, str, list[str], int]:
    """Streaming multipart parser using request.stream().

    spec: streaming-upload.md sec 1.1

    Reads the multipart body in bounded chunks via request.stream() and
    delegates each part to a MultipartParser.  Form-field values accumulate
    in memory; file bytes are written directly to disk via CacheWriter.

    Limits match the synchronous path: *max_file_size* applies to every file
    part and *max_upload_size* to the sum of file bytes (multipart framing is
    not counted).  Form fields are capped separately so a malformed request
    cannot grow the in-memory buffer without bound.
    """
    from python_multipart.multipart import MultipartParser, parse_options_header

    content_type = request.headers.get("content-type", "")
    if "boundary=" not in content_type:
        raise HTTPException(status_code=400, detail="Missing multipart boundary")

    boundary = content_type.rsplit("boundary=", 1)[-1].strip().strip('"')
    writer = cache.create_streaming_cache()

    data: dict = {}
    file_names: list[str] = []
    total_bytes = 0
    form_bytes = 0
    # (field, filename, content_type, chunk, is_first_chunk_of_part)
    pending: list[tuple[str, str, str, bytes, bool]] = []

    current_field: str | None = None
    current_filename: str | None = None
    current_content_type = "application/octet-stream"
    current_is_file = False
    current_file_part_started = False
    current_file_bytes = 0
    current_form_buf = bytearray()
    header_field = ""

    def on_part_begin() -> None:
        nonlocal current_field, current_filename, current_content_type
        nonlocal current_is_file, current_form_buf, current_file_part_started
        nonlocal current_file_bytes
        current_field = None
        current_filename = None
        current_content_type = "application/octet-stream"
        current_is_file = False
        current_file_part_started = False
        current_file_bytes = 0
        current_form_buf = bytearray()

    def on_header_field(data: bytes, start: int, end: int) -> None:
        nonlocal header_field
        header_field = data[start:end].decode("latin-1").lower()

    def on_header_value(data: bytes, start: int, end: int) -> None:
        nonlocal header_field, current_field, current_filename
        nonlocal current_content_type, current_is_file
        value = data[start:end].decode("latin-1")
        if header_field == "content-disposition":
            _, params = parse_options_header(data[start:end])
            name = params.get(b"name")
            current_field = name.decode("utf-8") if name else None
            fn = params.get(b"filename")
            if fn:
                if current_field != "files":
                    raise HTTPException(
                        status_code=400,
                        detail="Every upload part must be named files",
                    )
                current_filename = fn.decode("utf-8")
                current_is_file = True
        elif header_field == "content-type" and current_is_file:
            current_content_type = value

    def on_part_data(data: bytes, start: int, end: int) -> None:
        nonlocal total_bytes, form_bytes, current_file_bytes, current_file_part_started
        chunk = data[start:end]
        chunk_len = len(chunk)
        if current_is_file:
            current_file_bytes += chunk_len
            if current_file_bytes > max_file_size:
                raise HTTPException(
                    status_code=413,
                    detail=f"File exceeds max size ({max_file_size} bytes)",
                )
            total_bytes += chunk_len
            if total_bytes > max_upload_size:
                # Cancellation happens in the caller's except block: this
                # callback is synchronous, so it cannot await the async cancel().
                raise HTTPException(
                    status_code=413,
                    detail=f"Upload exceeds max size ({max_upload_size} bytes)",
                )
            pending.append(
                (
                    current_field or "file",
                    current_filename or "unnamed",
                    current_content_type,
                    chunk,
                    not current_file_part_started,
                )
            )
            current_file_part_started = True
        else:
            form_bytes += chunk_len
            if form_bytes > _MAX_FORM_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail="Form fields exceed max size",
                )
            current_form_buf.extend(chunk)

    def on_part_end() -> None:
        nonlocal current_form_buf
        if not current_is_file and current_field is not None:
            _store_form_field(data, current_field, current_form_buf.decode("utf-8"))
            current_form_buf = bytearray()
        if current_is_file and current_filename:
            file_names.append(current_filename)

    callbacks: dict = {  # type: ignore[var-annotated]
        "on_part_begin": on_part_begin,
        "on_part_data": on_part_data,
        "on_part_end": on_part_end,
        "on_header_field": on_header_field,
        "on_header_value": on_header_value,
    }

    parser = MultipartParser(boundary.encode(), callbacks, max_size=float("inf"))

    try:
        async for chunk in request.stream():
            parser.write(chunk)
            for args in pending:
                await writer.write_file_chunk(*args)
            pending.clear()

        cache_dir = await writer.finish(data)
    except BaseException:
        # Covers disconnect, parse errors, 413 (size limit) and finish()
        # failures: the partial cache directory must never be orphaned.
        try:
            await writer.cancel()
        except Exception:
            # Best effort. A failing cleanup (for example the default executor
            # is already shut down) must not replace the error being raised.
            logger.warning(
                "Failed to cancel cache dir after aborted upload", exc_info=True
            )
        raise

    return data, cache_dir, file_names, total_bytes


def _relay_response(resp) -> Response:
    """Relay an upstream httpx.Response byte-for-byte."""
    excluded = {
        "content-length",
        "content-encoding",
        "transfer-encoding",
        "connection",
        "x-request-id",
    }
    headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=headers,
        media_type=resp.headers.get("content-type"),
    )


def _normalize_idempotency_key(raw: str | None) -> str | None:
    if raw is None:
        return None
    stripped = raw.strip()
    if not stripped:
        return None
    if len(stripped) > 255:
        raise HTTPException(
            status_code=422,
            detail="X-Idempotency-Key must not exceed 255 characters",
        )
    return stripped


def _build_replay_response(task, settings: Settings) -> JSONResponse:
    return JSONResponse(
        status_code=202,
        content={
            "task_id": str(task.id),
            "status": "pending",
            "tier": task.tier,
            "file_names": task.file_names,
            "created_at": task.created_at.isoformat(),
            "status_url": f"{settings.gateway_url}/tasks/{task.id}",
            "result_url": f"{settings.gateway_url}/tasks/{task.id}/result",
            "started_at": None,
            "completed_at": None,
            "error": None,
            "message": "Task submitted successfully",
        },
        headers={
            "X-MinerU-Task-Id": str(task.id),
            "X-MinerU-Task-Status": "pending",
            "X-MinerU-Task-Status-Url": f"{settings.gateway_url}/tasks/{task.id}",
            "X-MinerU-Task-Result-Url": f"{settings.gateway_url}/tasks/{task.id}/result",
            "X-Idempotency-Key-Replayed": "true",
        },
    )


async def handle_task_submission(
    request: Request,
    api_key: ApiKey | None,
    session: AsyncSession,
    upstream: UpstreamClient,
    limiter: MemoryTokenBucket,
    cache: FileCache,
    settings: Settings,
    x_idempotency_key: str | None = None,
) -> Response:
    # Defensive: anonymous only allowed when configured.
    if api_key is None and not settings.allow_anonymous:
        raise HTTPException(status_code=401, detail="API key required")

    idempotency_key = _normalize_idempotency_key(x_idempotency_key)
    api_key_id = api_key.id if api_key is not None else None

    if api_key_id is not None and idempotency_key is not None:
        existing = await task_service.get_by_idempotency_key(
            session, api_key_id, idempotency_key
        )
        if existing is not None:
            return _build_replay_response(existing, settings)

    if api_key_id is not None and not await limiter.acquire(str(api_key_id)):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded",
            headers={"Retry-After": "60"},
        )

    data, cache_dir, file_names, total_bytes = await _extract_multipart_streaming(
        request, settings.max_upload_size, settings.max_file_size, cache
    )
    try:
        params, tier = _parse_options(data, sync=False, include_zip=True)
    except BaseException:
        # The streaming parser has already finalized the cache directory. It
        # is not attached to a task yet, so no background cleanup can find it.
        await cache.release(cache_dir)
        raise

    # Anonymous: read files from on-disk cache, forward to upstream,
    # then release the cache directory immediately (no record kept).
    # spec: streaming-upload.md sec 1.2
    if api_key is None:
        try:
            _, files = await cache.restore(cache_dir)
            upstream_resp = await upstream.submit_task(params, v1_files(files))
        except Exception:
            await cache.release(cache_dir)
            raise
        await cache.release(cache_dir)
        return _relay_response(upstream_resp)

    # Authenticated: stage the original multipart for crash recovery, then
    # forward. Release the cache if the upstream rejects the submission.
    # Global concurrency cap (§3.5): reject when too many tasks are in flight.
    if settings.max_concurrent_tasks > 0:
        in_flight = await task_service.count_in_flight(session)
        if in_flight >= settings.max_concurrent_tasks:
            await cache.release(cache_dir)
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Global concurrency limit reached "
                    f"({in_flight}/{settings.max_concurrent_tasks})"
                ),
                headers={"Retry-After": "10"},
            )

    try:
        _, files = await cache.restore(cache_dir)
        upstream_resp = await upstream.submit_task(params, v1_files(files))
    except Exception:
        # The staged upload is kept in the task record on success, so it must
        # be released whenever the submission never produced one.
        await cache.release(cache_dir)
        raise
    if upstream_resp.status_code != 202:
        await cache.release(cache_dir)
        return _relay_response(upstream_resp)
    try:
        payload = upstream_resp.json()
    except ValueError:
        await cache.release(cache_dir)
        raise HTTPException(status_code=502, detail="Invalid upstream response")

    qa = payload.get("queued_ahead")
    queued_ahead: int | None = qa if isinstance(qa, int) else None
    upstream_tier = payload.get("tier")
    if isinstance(upstream_tier, str) and upstream_tier in VALID_TIERS:
        tier = upstream_tier
    try:
        task = await task_service.create(
            session,
            api_key_id=api_key_id,
            status="pending",
            upstream_url=settings.upstream_url,
            upstream_task_id=payload.get("task_id"),
            file_names=payload.get("file_names", file_names),
            file_count=len(file_names),
            file_total_bytes=total_bytes,
            tier=tier,
            cache_dir=cache_dir,
            queued_ahead=queued_ahead,
            idempotency_key=idempotency_key,
            parse_params=params,
        )
    except IntegrityError:
        await session.rollback()
        await cache.release(cache_dir)
        # The loser may already have submitted to upstream; its task has no
        # record, so surface it instead of leaving it silent.
        orphan_upstream_task_id = payload.get("task_id")
        if orphan_upstream_task_id:
            reason = (
                "Idempotency conflict"
                if idempotency_key is not None
                else "Task record insert conflict"
            )
            logger.warning(
                "%s; orphan upstream task %s",
                reason,
                orphan_upstream_task_id,
                extra={
                    "orphan_upstream_task_id": str(orphan_upstream_task_id),
                    "idempotency_key": idempotency_key,
                    "api_key_id": str(api_key_id) if api_key_id else None,
                    "upstream_url": settings.upstream_url,
                    "tier": tier,
                    "file_names": file_names[:10],
                    "file_count": len(file_names),
                },
            )
        if api_key_id is None or idempotency_key is None:
            raise
        existing = await task_service.get_by_idempotency_key(
            session, api_key_id, idempotency_key
        )
        if existing is not None:
            return _build_replay_response(existing, settings)
        raise

    return JSONResponse(
        status_code=202,
        content={
            "task_id": str(task.id),
            "status": "pending",
            "tier": task.tier,
            "file_names": task.file_names,
            "created_at": task.created_at.isoformat(),
            "status_url": f"{settings.gateway_url}/tasks/{task.id}",
            "result_url": f"{settings.gateway_url}/tasks/{task.id}/result",
            "started_at": None,
            "completed_at": None,
            "error": None,
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

    data, files, file_names, total_bytes = await _extract_multipart(
        request, settings.max_upload_size, settings.max_file_size
    )
    params, tier = _parse_options(data, sync=True)

    upstream_resp = await upstream.parse_file(params, v1_files(files))

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
            tier=tier,
            parse_params=params,
        )

    return _relay_response(upstream_resp)
