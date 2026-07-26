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
from sqlalchemy.exc import IntegrityError
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


def _extract_parse_params(data: dict) -> dict:
    """Extract all parse parameters from the multipart form into the JSON blob.

    Returns a dict containing all upstream parse parameters (including backend,
    parse_method, effort), suitable for storage in TaskRecord.parse_params.
    """
    params: dict = {}
    if "backend" in data:
        params["backend"] = data["backend"]
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


async def _extract_multipart_streaming(
    request: Request, max_upload_size: int, cache: FileCache
) -> tuple[dict, str, list[str], int]:
    """Streaming multipart parser using request.stream().

    spec: streaming-upload.md sec 1.1

    Reads the multipart body in bounded chunks via request.stream() and
    delegates each part to a MultipartParser.  Form-field values accumulate
    in memory; file bytes are written directly to disk via CacheWriter.
    Cumulative byte count (all received bytes) is checked per chunk — if
    *max_upload_size* is exceeded the stream is abandoned, the partial
    cache is cancelled, and a 413 is raised.
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
    file_bytes = 0
    pending: list[tuple[str, str, str, bytes]] = []

    current_field: str | None = None
    current_filename: str | None = None
    current_content_type = "application/octet-stream"
    current_is_file = False
    current_form_buf = bytearray()
    header_field = ""

    def on_part_begin() -> None:
        nonlocal current_field, current_filename, current_content_type
        nonlocal current_is_file, current_form_buf
        current_field = None
        current_filename = None
        current_content_type = "application/octet-stream"
        current_is_file = False
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
                current_filename = fn.decode("utf-8")
                current_is_file = True
        elif header_field == "content-type" and current_is_file:
            current_content_type = value

    def on_part_data(data: bytes, start: int, end: int) -> None:
        nonlocal total_bytes, file_bytes
        chunk = data[start:end]
        chunk_len = len(chunk)
        total_bytes += chunk_len
        if total_bytes > max_upload_size:
            writer.cancel()
            raise HTTPException(
                status_code=413,
                detail=f"Upload exceeds max size ({max_upload_size} bytes)",
            )
        if current_is_file:
            file_bytes += chunk_len
            pending.append(
                (
                    current_field or "file",
                    current_filename or "unnamed",
                    current_content_type,
                    chunk,
                )
            )
        else:
            current_form_buf.extend(chunk)

    def on_part_end() -> None:
        nonlocal current_form_buf
        if not current_is_file and current_field is not None:
            data[current_field] = current_form_buf.decode("utf-8")
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
    except HTTPException:
        raise
    except BaseException:
        writer.cancel()
        raise

    return data, cache_dir, file_names, file_bytes


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
            "backend": task.backend,
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

    await check_free_slot(upstream)

    data, cache_dir, file_names, total_bytes = await _extract_multipart_streaming(
        request, settings.max_upload_size, cache
    )

    # Anonymous: read files from on-disk cache, forward to upstream,
    # then release the cache directory immediately (no record kept).
    # spec: streaming-upload.md sec 1.2
    if api_key is None:
        _, files = await cache.restore(cache_dir)
        upstream_resp = await upstream.submit_task(data, files)
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

    _, files = await cache.restore(cache_dir)
    upstream_resp = await upstream.submit_task(data, files)
    if upstream_resp.status_code != 202:
        await cache.release(cache_dir)
        raise HTTPException(
            status_code=upstream_resp.status_code, detail=upstream_resp.text
        )
    payload = upstream_resp.json()

    qa = payload.get("queued_ahead")
    queued_ahead: int | None = qa if isinstance(qa, int) else None

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
            backend=data.get("backend", "hybrid-engine"),
            cache_dir=cache_dir,
            queued_ahead=queued_ahead,
            idempotency_key=idempotency_key,
            parse_params=_extract_parse_params(data),
        )
    except IntegrityError:
        await session.rollback()
        await cache.release(cache_dir)
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
            "backend": task.backend,
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
            parse_params=_extract_parse_params(data),
        )

    return _relay_response(upstream_resp)
