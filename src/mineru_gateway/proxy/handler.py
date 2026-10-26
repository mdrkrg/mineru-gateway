"""Core proxy handlers for POST /v1/tasks and POST /v1/file_parse.

Authenticated `POST /v1/tasks` stages the original multipart to the file cache
(for crash recovery, §6.2/§6.4) before forwarding, records the task with its
cache_dir, and returns the Gateway-flavored response. Anonymous requests are a
pure passthrough. `POST /v1/file_parse` normally returns its result directly; if
MinerU's wait budget expires, the accepted task is persisted and staged for
the same polling/recovery path as an asynchronous submission.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

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
    MAX_TASK_FILES,
    parse_v1_params,
)
from ..upstream.schemas import (
    UpstreamTaskPayload,
    UpstreamTaskReference,
    gateway_task_status,
    task_reference_from_headers,
    validate_submission_payload,
)
from ..upstream.response import relay_headers, relay_response

logger = logging.getLogger(__name__)

_MAX_FORM_BYTES = 1024 * 1024

_REPEATABLE_FORM_FIELDS = {"output_formats"}


def _task_url(settings: Settings, task_id: object) -> str:
    return f"{settings.gateway_url.rstrip('/')}/v1/tasks/{task_id}"


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
    form = await request.form(max_files=MAX_TASK_FILES)
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
    _, content_type_params = parse_options_header(content_type.encode("latin-1"))
    boundary = content_type_params.get(b"boundary")
    if not boundary:
        raise HTTPException(status_code=400, detail="Missing multipart boundary")
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
    current_file_part_counted = False
    current_file_bytes = 0
    file_count = 0
    current_form_buf = bytearray()
    header_field_buf = bytearray()
    header_value_buf = bytearray()

    def on_part_begin() -> None:
        nonlocal current_field, current_filename, current_content_type
        nonlocal current_is_file, current_form_buf, current_file_part_started
        nonlocal current_file_bytes, current_file_part_counted
        current_field = None
        current_filename = None
        current_content_type = "application/octet-stream"
        current_is_file = False
        current_file_part_started = False
        current_file_part_counted = False
        current_file_bytes = 0
        current_form_buf = bytearray()

    def on_header_begin() -> None:
        nonlocal header_field_buf, header_value_buf
        header_field_buf = bytearray()
        header_value_buf = bytearray()

    def on_header_field(data: bytes, start: int, end: int) -> None:
        header_field_buf.extend(data[start:end])

    def on_header_value(data: bytes, start: int, end: int) -> None:
        header_value_buf.extend(data[start:end])

    def on_header_end() -> None:
        nonlocal current_field, current_filename
        nonlocal current_content_type, current_is_file
        header_field = header_field_buf.decode("latin-1").lower()
        value = bytes(header_value_buf)
        if header_field == "content-disposition":
            _, params = parse_options_header(value)
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
        elif header_field == "content-type":
            current_content_type = value.decode("latin-1")

    def on_part_data(data: bytes, start: int, end: int) -> None:
        nonlocal total_bytes, form_bytes, current_file_bytes, current_file_part_started
        nonlocal current_file_part_counted, file_count
        chunk = data[start:end]
        chunk_len = len(chunk)
        if current_is_file:
            if not current_file_part_counted:
                file_count += 1
                current_file_part_counted = True
                if file_count > MAX_TASK_FILES:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Too many files (maximum {MAX_TASK_FILES})",
                    )
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
        nonlocal current_form_buf, current_file_part_counted, file_count
        if not current_is_file and current_field is not None:
            _store_form_field(data, current_field, current_form_buf.decode("utf-8"))
            current_form_buf = bytearray()
        if current_is_file and current_filename:
            if not current_file_part_counted:
                file_count += 1
                current_file_part_counted = True
                if file_count > MAX_TASK_FILES:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Too many files (maximum {MAX_TASK_FILES})",
                    )
            file_names.append(current_filename)

    callbacks: dict = {  # type: ignore[var-annotated]
        "on_part_begin": on_part_begin,
        "on_part_data": on_part_data,
        "on_part_end": on_part_end,
        "on_header_begin": on_header_begin,
        "on_header_field": on_header_field,
        "on_header_value": on_header_value,
        "on_header_end": on_header_end,
    }

    parser = MultipartParser(boundary, callbacks, max_size=float("inf"))

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


def _file_parse_task_metadata(
    resp,
) -> tuple[UpstreamTaskReference, dict[str, Any] | None]:
    """Validate task identity and status from a V1 file-parse response."""
    content_type = resp.headers.get("content-type", "").split(";", 1)[0].lower()
    if content_type == "application/json" or content_type.endswith("+json"):
        raw_payload = resp.json()
        payload = UpstreamTaskPayload.model_validate(raw_payload)
        reference = UpstreamTaskReference(
            task_id=payload.task_id,
            status=payload.status,
            tier=payload.tier,
        )
    else:
        raw_payload = None
        reference = task_reference_from_headers(resp.headers)

    expected_statuses = {
        200: {"completed", "partial"},
        202: {"queued", "running"},
        409: {"failed", "canceled"},
    }
    if reference.status not in expected_statuses[resp.status_code]:
        raise ValueError(
            f"status {reference.status!r} is invalid for HTTP {resp.status_code}"
        )
    return reference, raw_payload


def _tracked_response_headers(resp, task, settings: Settings) -> dict[str, str]:
    """Relay response headers while replacing upstream task references."""
    headers = {
        key: value
        for key, value in relay_headers(resp).items()
        if not key.lower().startswith("x-mineru-task-")
    }
    task_url = _task_url(settings, task.id)
    headers.update(
        {
            "X-MinerU-Task-Id": str(task.id),
            "X-MinerU-Task-Status": task.status,
            "X-MinerU-Task-Status-Url": task_url,
            "X-MinerU-Task-Result-Url": f"{task_url}/result",
        }
    )
    return headers


def _tracked_task_response(
    resp,
    payload: dict[str, Any],
    task,
    settings: Settings,
) -> JSONResponse:
    """Replace an upstream task reference with its gateway-owned identity."""
    task_url = _task_url(settings, task.id)
    content = dict(payload)
    content.update(
        {
            "task_id": str(task.id),
            "status": task.status,
            "status_url": task_url,
            "result_url": f"{task_url}/result",
            "links": {"self": task_url, "cancel": task_url},
        }
    )
    return JSONResponse(
        status_code=resp.status_code,
        content=content,
        headers=_tracked_response_headers(resp, task, settings),
    )


def _tracked_binary_response(resp, task, settings: Settings) -> Response:
    """Relay binary task output while replacing upstream task headers."""
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=_tracked_response_headers(resp, task, settings),
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
    task_url = _task_url(settings, task.id)
    return JSONResponse(
        status_code=202,
        content={
            "task_id": str(task.id),
            "status": "pending",
            "tier": task.tier,
            "file_names": task.file_names,
            "created_at": task.created_at.isoformat(),
            "status_url": task_url,
            "result_url": f"{task_url}/result",
            "started_at": None,
            "completed_at": None,
            "error": None,
            "message": "Task submitted successfully",
        },
        headers={
            "X-MinerU-Task-Id": str(task.id),
            "X-MinerU-Task-Status": "pending",
            "X-MinerU-Task-Status-Url": task_url,
            "X-MinerU-Task-Result-Url": f"{task_url}/result",
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
            upstream_resp = await upstream.submit_task(params, files)
        except Exception, asyncio.CancelledError:
            await cache.release(cache_dir)
            raise
        await cache.release(cache_dir)
        return relay_response(upstream_resp)

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
        upstream_resp = await upstream.submit_task(params, files)
    except Exception, asyncio.CancelledError:
        # The staged upload is kept in the task record on success, so it must
        # be released whenever the submission never produced one.
        await cache.release(cache_dir)
        raise
    if upstream_resp.status_code != 202:
        await cache.release(cache_dir)
        return relay_response(upstream_resp)
    try:
        raw_payload = upstream_resp.json()
        payload = validate_submission_payload(raw_payload)
    except ValueError as exc:
        await cache.release(cache_dir)
        raise HTTPException(
            status_code=502, detail=f"Invalid upstream task response: {exc}"
        ) from exc

    tier = payload.tier
    try:
        task = await task_service.create(
            session,
            api_key_id=api_key_id,
            status=gateway_task_status(payload.status),
            upstream_url=settings.upstream_url,
            upstream_task_id=payload.task_id,
            file_names=file_names,
            file_count=len(file_names),
            file_total_bytes=total_bytes,
            tier=tier,
            cache_dir=cache_dir,
            idempotency_key=idempotency_key,
            parse_params=params,
        )
    except IntegrityError:
        await session.rollback()
        await cache.release(cache_dir)
        # The loser may already have submitted to upstream; its task has no
        # record, so surface it instead of leaving it silent.
        reason = (
            "Idempotency conflict"
            if idempotency_key is not None
            else "Task record insert conflict"
        )
        logger.warning(
            "%s; orphan upstream task %s",
            reason,
            payload.task_id,
            extra={
                "orphan_upstream_task_id": str(payload.task_id),
                "idempotency_key": idempotency_key,
                "api_key_id": str(api_key_id),
                "upstream_url": settings.upstream_url,
                "tier": tier,
                "file_names": file_names[:10],
                "file_count": len(file_names),
            },
        )
        if idempotency_key is None:
            raise
        existing = await task_service.get_by_idempotency_key(
            session, api_key_id, idempotency_key
        )
        if existing is not None:
            return _build_replay_response(existing, settings)
        raise

    task_url = _task_url(settings, task.id)
    return JSONResponse(
        status_code=202,
        content={
            "task_id": str(task.id),
            "status": task.status,
            "tier": task.tier,
            "file_names": task.file_names,
            "created_at": task.created_at.isoformat(),
            "status_url": task_url,
            "result_url": f"{task_url}/result",
            "started_at": None,
            "completed_at": None,
            "error": None,
            "message": "Task submitted successfully",
        },
        headers={
            "X-MinerU-Task-Id": str(task.id),
            "X-MinerU-Task-Status": task.status,
            "X-MinerU-Task-Status-Url": task_url,
            "X-MinerU-Task-Result-Url": f"{task_url}/result",
        },
    )


async def handle_file_parse(
    request: Request,
    api_key: ApiKey | None,
    session: AsyncSession,
    upstream: UpstreamClient,
    limiter: MemoryTokenBucket,
    cache: FileCache,
    settings: Settings,
) -> Response:
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

    upstream_resp = await upstream.parse_file(params, files)

    if api_key is None or upstream_resp.status_code not in {200, 202, 409}:
        return relay_response(upstream_resp)

    try:
        reference, raw_payload = _file_parse_task_metadata(upstream_resp)
    except ValueError as exc:
        raise HTTPException(
            status_code=502, detail=f"Invalid upstream task response: {exc}"
        ) from exc

    status = gateway_task_status(reference.status)
    cache_dir: str | None = None
    if upstream_resp.status_code == 202:
        retry_params = {
            key: value
            for key, value in params.items()
            if key not in {"response_format", "wait_timeout"}
        }
        try:
            cache_dir = await cache.store(retry_params, files)
        except Exception:
            # The upstream already accepted this task. Keep it trackable even
            # if local disaster-recovery staging is unavailable.
            logger.warning("Failed to cache timed-out file_parse upload", exc_info=True)

    now = datetime.now(timezone.utc)
    try:
        task = await task_service.create(
            session,
            api_key_id=api_key.id,
            status=status,
            upstream_url=settings.upstream_url,
            upstream_task_id=reference.task_id,
            file_names=file_names,
            file_count=len(file_names),
            file_total_bytes=total_bytes,
            tier=reference.tier or tier,
            parse_params=params,
            cache_dir=cache_dir,
            started_at=now if status == "processing" else None,
            completed_at=now if status in task_service.TERMINAL_STATES else None,
            upstream_error=(
                task_service.upstream_error_from_payload(raw_payload)
                if raw_payload is not None and status in {"partial", "failed"}
                else None
            ),
        )
    except BaseException:
        await cache.release(cache_dir)
        raise

    if raw_payload is not None:
        return _tracked_task_response(upstream_resp, raw_payload, task, settings)
    if upstream_resp.status_code == 202:
        response_payload = {
            "task_id": reference.task_id,
            "status": reference.status,
            "tier": reference.tier,
            "output_formats": params["output_formats"],
            "files": [],
        }
        return _tracked_task_response(upstream_resp, response_payload, task, settings)

    return _tracked_binary_response(upstream_resp, task, settings)
