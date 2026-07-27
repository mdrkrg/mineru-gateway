"""Streaming multipart upload tests for POST /tasks.

Spec: streaming-upload.md sec 6 (Test Scenarios).
Labels T1-T15 map to spec sections S1-S15.
"""

from __future__ import annotations

import json
import os
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from asgi_lifespan import LifespanManager

from mineru_gateway.config import Settings
from mineru_gateway.main import create_app
from mineru_gateway.models import TaskRecord

from tests.mock_upstream import create_mock_upstream, state as mock_state


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _example_files() -> list[tuple[str, tuple[str, bytes, str]]]:
    return [("files", ("doc.pdf", b"%PDF-1.4 fake pdf bytes", "application/pdf"))]


def _check_cache_dir_layout(cache_dir: str, expected_files: int) -> None:
    """Verify the on-disk cache layout matches spec sec 2.2."""
    assert os.path.isdir(cache_dir), f"cache_dir missing: {cache_dir}"
    assert os.path.isfile(os.path.join(cache_dir, "form.json"))
    assert os.path.isfile(os.path.join(cache_dir, "files.json"))
    for i in range(expected_files):
        assert os.path.isfile(os.path.join(cache_dir, f"blob-{i}"))


def _read_form_json(cache_dir: str) -> dict:
    with open(os.path.join(cache_dir, "form.json")) as fh:
        return json.load(fh)


def _read_files_json(cache_dir: str) -> list[dict]:
    with open(os.path.join(cache_dir, "files.json")) as fh:
        return json.load(fh)


def _count_cache_dirs(cache_base: str) -> int:
    if not os.path.isdir(cache_base):
        return 0
    return len(os.listdir(cache_base))


async def _make_streaming_app(
    tmp_path, *, max_upload_size: int, allow_anonymous: bool = False
):
    """Create a test app + httpx client with a configurable max_upload_size."""
    settings = Settings(
        upstream_url="http://mock-upstream",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'stream.db'}",
        admin_token="test-admin-token",
        allow_anonymous=allow_anonymous,
        gateway_url="http://testserver",
        max_upload_size=max_upload_size,
        file_cache_dir=str(tmp_path / "cache"),
        enable_background=False,
        json_logs=False,
        create_tables=True,
    )
    upstream = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_mock_upstream()),
        base_url="http://mock-upstream",
    )
    app = create_app(settings=settings, upstream_client=upstream)
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            yield c, app, settings


# ---------------------------------------------------------------------------
# T1 -- Small-file normal submission (regression)
# spec: streaming-upload.md sec 6.1 S1
# ---------------------------------------------------------------------------


async def test_t1_small_file_normal_submit(client, api_key):
    resp = await client.post(
        "/tasks",
        headers={"X-API-Key": api_key},
        files=_example_files(),
    )
    assert resp.status_code == 202
    body = resp.json()
    assert body["task_id"]
    assert body["status"] == "pending"
    assert body["file_names"] == ["doc.pdf"]

    task_id = uuid.UUID(body["task_id"])
    async with client._transport.app.state.db.session_factory() as session:
        task = await session.get(TaskRecord, task_id)
        assert task is not None
        assert task.file_names == ["doc.pdf"]
        assert task.file_count == 1
        assert task.file_total_bytes == len(b"%PDF-1.4 fake pdf bytes")
        cache_dir = task.cache_dir
        assert cache_dir is not None

    _check_cache_dir_layout(cache_dir, 1)
    form = _read_form_json(cache_dir)
    assert isinstance(form, dict)
    manifest = _read_files_json(cache_dir)
    assert len(manifest) == 1
    assert manifest[0]["filename"] == "doc.pdf"
    with open(os.path.join(cache_dir, "blob-0"), "rb") as fh:
        assert fh.read() == b"%PDF-1.4 fake pdf bytes"


# ---------------------------------------------------------------------------
# T2 -- Multi-file submission (regression)
# spec: streaming-upload.md sec 6.1 S2
# ---------------------------------------------------------------------------


async def test_t2_multi_file_submit(client, api_key):
    files = [
        ("files", ("a.pdf", b"aaa", "application/pdf")),
        ("files", ("b.pdf", b"bbbb", "application/pdf")),
        ("files", ("c.pdf", b"ccccc", "application/pdf")),
    ]
    resp = await client.post(
        "/tasks",
        headers={"X-API-Key": api_key},
        files=files,
    )
    assert resp.status_code == 202
    body = resp.json()
    assert body["file_names"] == ["a.pdf", "b.pdf", "c.pdf"]

    task_id = uuid.UUID(body["task_id"])
    async with client._transport.app.state.db.session_factory() as session:
        task = await session.get(TaskRecord, task_id)
        assert task.file_count == 3
        assert task.file_total_bytes == 3 + 4 + 5
        cache_dir = task.cache_dir

    _check_cache_dir_layout(cache_dir, 3)
    manifest = _read_files_json(cache_dir)
    assert [e["blob"] for e in manifest] == ["blob-0", "blob-1", "blob-2"]
    with open(os.path.join(cache_dir, "blob-0"), "rb") as fh:
        assert fh.read() == b"aaa"
    with open(os.path.join(cache_dir, "blob-1"), "rb") as fh:
        assert fh.read() == b"bbbb"
    with open(os.path.join(cache_dir, "blob-2"), "rb") as fh:
        assert fh.read() == b"ccccc"


# ---------------------------------------------------------------------------
# T3 -- Form field pass-through (regression)
# spec: streaming-upload.md sec 6.1 S3
# ---------------------------------------------------------------------------


async def test_t3_form_fields_passthrough(client, api_key):
    resp = await client.post(
        "/tasks",
        headers={"X-API-Key": api_key},
        files=_example_files(),
        data={
            "backend": "pipeline",
            "parse_method": "auto",
            "return_md": "true",
        },
    )
    assert resp.status_code == 202
    task_id = uuid.UUID(resp.json()["task_id"])

    async with client._transport.app.state.db.session_factory() as session:
        task = await session.get(TaskRecord, task_id)
        assert task.backend == "pipeline"
        assert task.parse_params.get("parse_method") == "auto"
        assert task.parse_params.get("return_md") is True
        cache_dir = task.cache_dir

    form = _read_form_json(cache_dir)
    assert form.get("backend") == "pipeline"
    assert form.get("parse_method") == "auto"
    assert form.get("return_md") == "true"

    # Verify upstream received the same form fields (spec sec 6.1 S3)
    assert len(mock_state.submitted) == 1
    upstream_form = mock_state.submitted[0]["form"]
    assert upstream_form.get("backend") == "pipeline"
    assert upstream_form.get("parse_method") == "auto"
    assert upstream_form.get("return_md") == "true"


# ---------------------------------------------------------------------------
# T4 -- Anonymous submission (regression)
# spec: streaming-upload.md sec 6.1 S4
# ---------------------------------------------------------------------------


async def test_t4_anonymous_submit(tmp_path):
    settings = Settings(
        upstream_url="http://mock-upstream",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 't4.db'}",
        admin_token="test-admin-token",
        allow_anonymous=True,
        gateway_url="http://testserver",
        file_cache_dir=str(tmp_path / "cache"),
        enable_background=False,
        json_logs=False,
        create_tables=True,
    )
    upstream_client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_mock_upstream()),
        base_url="http://mock-upstream",
    )
    app = create_app(settings=settings, upstream_client=upstream_client)
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            resp = await c.post("/tasks", files=_example_files())
            assert resp.status_code == 202
            assert resp.json()["task_id"].startswith("up-")

        # No DB record for anonymous
        from sqlalchemy import func, select

        async with app.state.db.session_factory() as session:
            count = await session.scalar(select(func.count()).select_from(TaskRecord))
            assert count == 0

        # Cache directory must be cleaned up after forwarding
        cache_base = settings.file_cache_dir
        if os.path.isdir(cache_base):
            contents = os.listdir(cache_base)
            assert len(contents) == 0, f"orphaned cache dirs: {contents}"


# ---------------------------------------------------------------------------
# T5 -- Streaming parser uses request.stream(), not request.form()
# spec: streaming-upload.md sec 6.2 S5
#
# The streaming multipart parser must process the body via request.stream()
# in bounded chunks rather than loading the entire body with request.form().
# This behavioural test mocks request.form() to raise and verifies the
# streaming parser never calls it.  The stub delegates to _extract_multipart
# which calls request.form(), so this test FAILS with the stub and PASSES
# once the real streaming parser is implemented.
# ---------------------------------------------------------------------------


async def test_t5_streaming_parser_uses_request_stream(tmp_path):
    from starlette.datastructures import FormData

    from mineru_gateway.proxy.handler import _extract_multipart_streaming
    from mineru_gateway.tasks.cache import FileCache

    request = AsyncMock()
    request.headers = MagicMock()
    request.headers.get.return_value = (
        "multipart/form-data; boundary=------testboundary"
    )
    request.form = AsyncMock(return_value=FormData())

    # Real async generator for request.stream()
    class _MockStream:
        def __init__(self):
            boundary = b"------testboundary"
            self._chunks = [
                b"--" + boundary + b"\r\n",
                b'Content-Disposition: form-data; name="files"; filename="t.pdf"\r\n',
                b"Content-Type: application/pdf\r\n\r\n",
                b"fake-pdf-bytes\r\n",
                b"--" + boundary + b"--\r\n",
            ]
            self._i = 0

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self._i >= len(self._chunks):
                raise StopAsyncIteration
            chunk = self._chunks[self._i]
            self._i += 1
            return chunk

    request.stream = MagicMock(return_value=_MockStream())

    cache = FileCache(str(tmp_path / "t5-cache"))

    await _extract_multipart_streaming(request, 10_000_000, cache)

    request.form.assert_not_called()


# ---------------------------------------------------------------------------
# T6 -- Over-limit immediate rejection
# spec: streaming-upload.md sec 6.2 S6
#
# When cumulative received bytes exceed max_upload_size the server must:
#   - return 413 immediately (stop consuming the stream)
#   - leave no on-disk cache directory
#   - create no TaskRecord
# Immediate-stream-stop is observable only with real sockets; this test
# verifies 413 + no residues.
# ---------------------------------------------------------------------------


async def test_t6_over_limit_rejected(tmp_path):
    limit = 50_000
    file_size = limit + 10_000  # definitely over

    gen = _make_streaming_app(tmp_path, max_upload_size=limit)
    async for client, app, settings in gen:
        r = await client.post(
            "/auth/keys",
            json={"label": "t6"},
            headers={"X-Admin-Token": "test-admin-token"},
        )
        api_key = r.json()["api_key"]

        files = [("files", ("big.bin", b"x" * file_size, "application/octet-stream"))]
        resp = await client.post("/tasks", headers={"X-API-Key": api_key}, files=files)
        assert resp.status_code == 413
        detail = resp.json().get("detail", "")
        assert str(limit) in detail, f"413 detail must mention max size, got: {detail}"

        # No cache directories should be left behind
        cache_base = settings.file_cache_dir
        if os.path.isdir(cache_base):
            assert _count_cache_dirs(cache_base) == 0, "orphaned cache dir after 413"

        # No TaskRecord
        from sqlalchemy import func, select

        async with app.state.db.session_factory() as session:
            count = await session.scalar(select(func.count()).select_from(TaskRecord))
            assert count == 0


# ---------------------------------------------------------------------------
# T7 -- Upload at exact max_upload_size boundary
# spec: streaming-upload.md sec 6.2 S7
# ---------------------------------------------------------------------------


async def test_t7_exact_limit_passes(tmp_path):
    limit = 80_000
    gen = _make_streaming_app(tmp_path, max_upload_size=limit)
    async for client, app, settings in gen:
        r = await client.post(
            "/auth/keys",
            json={"label": "t7"},
            headers={"X-Admin-Token": "test-admin-token"},
        )
        api_key = r.json()["api_key"]

        files = [("files", ("exact.bin", b"y" * limit, "application/octet-stream"))]
        resp = await client.post("/tasks", headers={"X-API-Key": api_key}, files=files)
        assert resp.status_code == 202
        body = resp.json()
        assert body["task_id"]

        task_id = uuid.UUID(body["task_id"])
        async with app.state.db.session_factory() as session:
            task = await session.get(TaskRecord, task_id)
            assert task.file_total_bytes == limit


# ---------------------------------------------------------------------------
# T8 -- Multi-file cumulative over-limit
# spec: streaming-upload.md sec 6.2 S8
# ---------------------------------------------------------------------------


async def test_t8_multi_file_cumulative_over_limit(tmp_path):
    limit = 60_000
    per_file = 25_000  # 3 * 25000 = 75000 > 60000
    gen = _make_streaming_app(tmp_path, max_upload_size=limit)
    async for client, app, settings in gen:
        r = await client.post(
            "/auth/keys",
            json={"label": "t8"},
            headers={"X-Admin-Token": "test-admin-token"},
        )
        api_key = r.json()["api_key"]

        files = [
            ("files", ("a.bin", b"a" * per_file, "application/octet-stream")),
            ("files", ("b.bin", b"b" * per_file, "application/octet-stream")),
            ("files", ("c.bin", b"c" * per_file, "application/octet-stream")),
        ]
        resp = await client.post("/tasks", headers={"X-API-Key": api_key}, files=files)
        assert resp.status_code == 413
        detail = resp.json().get("detail", "")
        assert str(limit) in detail, f"413 detail must mention max size, got: {detail}"

        # No cache directories left behind
        cache_base = settings.file_cache_dir
        if os.path.isdir(cache_base):
            assert _count_cache_dirs(cache_base) == 0, "orphaned cache dir after 413"

        # No TaskRecord
        from sqlalchemy import func, select

        async with app.state.db.session_factory() as session:
            count = await session.scalar(select(func.count()).select_from(TaskRecord))
            assert count == 0


# ---------------------------------------------------------------------------
# T9 -- CacheWriter.cancel() cleans partial directory
# spec: streaming-upload.md sec 6.3 S9
#
# When a client disconnects mid-stream or an upload is aborted, the
# partially written cache directory must be removed.  This test verifies
# that CacheWriter.cancel() deletes the directory and all partial files.
# The full integration scenario (request.stream() raises mid-parse, handler
# calls cancel()) will be verified once the real streaming parser is
# implemented.
# ---------------------------------------------------------------------------


async def test_t9_cache_writer_cancel_cleans_directory(tmp_path):
    from mineru_gateway.tasks.cache import CacheWriter

    writer = CacheWriter(str(tmp_path))
    await writer.write_file_chunk("files", "a.pdf", "application/pdf", b"part1")
    await writer.write_file_chunk("files", "a.pdf", "application/pdf", b"part2")
    await writer.write_file_chunk("files", "b.pdf", "application/pdf", b"more")

    cache_dir = writer._dir
    assert os.path.isdir(cache_dir)
    assert len(os.listdir(cache_dir)) == 2  # blobs written immediately (real streaming)

    writer.cancel()
    assert not os.path.isdir(cache_dir), "cancel() must remove the directory"


# ---------------------------------------------------------------------------
# T9b -- finish() failure cancels partial cache (integration)
# spec: streaming-upload.md sec 4.2
#
# When CacheWriter.finish() raises (e.g. disk full during metadata writes),
# the streaming parser must call writer.cancel() to remove the partially
# written cache directory.  Currently finish() sits outside the try/except
# that guards chunk processing, so this test FAILS — cancel is never called
# and the cache directory is orphaned.
# ---------------------------------------------------------------------------


async def test_t9b_finish_failure_calls_cancel(tmp_path):
    from unittest.mock import MagicMock

    from mineru_gateway.proxy.handler import _extract_multipart_streaming
    from mineru_gateway.tasks.cache import CacheWriter, FileCache

    # Writer that succeeds on write_file_chunk but fails on finish
    class _FailFinishWriter(CacheWriter):
        async def finish(self, form_fields):
            raise OSError("disk full during finish")

    cache = MagicMock(spec=FileCache)
    cache.create_streaming_cache.return_value = _FailFinishWriter(
        str(tmp_path / "cache")
    )

    request = AsyncMock()
    request.headers = MagicMock()
    request.headers.get.return_value = "multipart/form-data; boundary=------t9b"

    class _MockStream:
        def __init__(self):
            boundary = b"------t9b"
            self._chunks = [
                b"--" + boundary + b"\r\n",
                b'Content-Disposition: form-data; name="files"; filename="a.pdf"\r\n',
                b"Content-Type: application/pdf\r\n\r\n",
                b"chunk-data\r\n",
                b"--" + boundary + b"--\r\n",
            ]
            self._i = 0

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self._i >= len(self._chunks):
                raise StopAsyncIteration
            chunk = self._chunks[self._i]
            self._i += 1
            return chunk

    request.stream = MagicMock(return_value=_MockStream())

    with patch.object(_FailFinishWriter, "cancel") as mock_cancel:
        with pytest.raises(OSError, match="disk full during finish"):
            await _extract_multipart_streaming(request, 100_000, cache)

    mock_cancel.assert_called_once()


# ---------------------------------------------------------------------------
# T10 -- Upstream rejection cleans cache and surfaces error
# spec: streaming-upload.md sec 6.3 S10
# ---------------------------------------------------------------------------


async def test_t10_upstream_rejection_cleans_cache(tmp_path):
    mock_state.submit_status = 400

    gen = _make_streaming_app(tmp_path, max_upload_size=100_000)
    async for client, app, settings in gen:
        r = await client.post(
            "/auth/keys",
            json={"label": "t10"},
            headers={"X-Admin-Token": "test-admin-token"},
        )
        api_key = r.json()["api_key"]

        resp = await client.post(
            "/tasks",
            headers={"X-API-Key": api_key},
            files=_example_files(),
        )
        assert resp.status_code == 400
        assert resp.json() == {"detail": "upstream error"}
        assert "upstream error" in resp.text, "must relay upstream error message"

        # Cache directory must be cleaned up
        cache_base = settings.file_cache_dir
        if os.path.isdir(cache_base):
            assert _count_cache_dirs(cache_base) == 0, (
                "orphaned cache dir after rejection"
            )

        # No TaskRecord created
        from sqlalchemy import func, select

        async with app.state.db.session_factory() as session:
            count = await session.scalar(select(func.count()).select_from(TaskRecord))
            assert count == 0


# ---------------------------------------------------------------------------
# T12 -- Idempotency hit does not read request body
# spec: streaming-upload.md sec 6.4 S12
#
# When an existing idempotency key is replayed, the server must return
# 202 + X-Idempotency-Key-Replayed without reading the multipart body.
# This test verifies that no file bytes are written to a cache directory
# for the replay request.
# ---------------------------------------------------------------------------


async def test_t12_idempotent_replay_does_not_read_body(client, api_key):
    idem_key = "t12-no-body-key"
    headers = {"X-API-Key": api_key, "X-Idempotency-Key": idem_key}

    # First request: normal submission
    resp1 = await client.post("/tasks", headers=headers, files=_example_files())
    assert resp1.status_code == 202
    assert "X-Idempotency-Key-Replayed" not in resp1.headers

    # Count cache directories after first request
    cache_base = client._transport.app.state.settings.file_cache_dir
    dir_count_after_first = _count_cache_dirs(cache_base)

    # Second request with same key: replay without reading body
    large_file = [("files", ("huge.bin", b"x" * 50_000, "application/octet-stream"))]
    resp2 = await client.post("/tasks", headers=headers, files=large_file)
    assert resp2.status_code == 202
    assert resp2.headers.get("X-Idempotency-Key-Replayed") == "true"

    # No new cache directory should be created for the replay
    dir_count_after_replay = _count_cache_dirs(cache_base)
    assert dir_count_after_replay == dir_count_after_first, (
        f"cache dirs changed from {dir_count_after_first} to {dir_count_after_replay}; "
        f"replay should not create cache"
    )


# ---------------------------------------------------------------------------
# T13 -- Idempotency hit not rejected by upload size limit
# spec: streaming-upload.md sec 6.4 S13
# ---------------------------------------------------------------------------


async def test_t13_idempotent_replay_skips_size_check(client, api_key):
    idem_key = "t13-size-key"
    headers = {"X-API-Key": api_key, "X-Idempotency-Key": idem_key}
    max_size = client._transport.app.state.settings.max_upload_size

    # First request: normal submission (must fit within the small test limit)
    resp1 = await client.post("/tasks", headers=headers, files=_example_files())
    assert resp1.status_code == 202

    # Second request: same key, file exceeds max_upload_size
    over_limit = b"z" * (max_size + 100)
    files = [("files", ("oversized.bin", over_limit, "application/octet-stream"))]
    resp2 = await client.post("/tasks", headers=headers, files=files)
    assert resp2.status_code == 202, f"expected 202 (replay), got {resp2.status_code}"
    assert resp2.headers.get("X-Idempotency-Key-Replayed") == "true"
    assert resp1.json()["task_id"] == resp2.json()["task_id"]


# ---------------------------------------------------------------------------
# T14 -- Retry loop restores files from streaming cache
# spec: streaming-upload.md sec 6.5 S14
#
# The retry loop calls cache.restore(cache_dir) to recover files written
# by the streaming parser.  This test verifies that CacheWriter produces a
# directory that is fully compatible with cache.restore().
# ---------------------------------------------------------------------------


async def test_t14_restore_streaming_cache(tmp_path):
    from mineru_gateway.tasks.cache import FileCache

    cache = FileCache(str(tmp_path / "cache"))

    writer = cache.create_streaming_cache()
    await writer.write_file_chunk("files", "a.pdf", "application/pdf", b"hello")
    await writer.write_file_chunk("files", "b.txt", "text/plain", b"world")
    cache_dir = await writer.finish({"backend": "pipeline", "parse_method": "auto"})

    data, files = await cache.restore(cache_dir)
    assert data["backend"] == "pipeline"
    assert data["parse_method"] == "auto"
    assert len(files) == 2
    assert files[0][0] == "files"
    assert files[0][1] == ("a.pdf", b"hello", "application/pdf")
    assert files[1][0] == "files"
    assert files[1][1] == ("b.txt", b"world", "text/plain")


# ---------------------------------------------------------------------------
# T15 -- file_parse behaviour unchanged (uses old _extract_multipart)
# spec: streaming-upload.md sec 6.6 S15
# ---------------------------------------------------------------------------


async def test_t15_file_parse_unchanged(client, api_key):
    from sqlalchemy import func, select

    resp = await client.post(
        "/file_parse",
        headers={"X-API-Key": api_key},
        files=_example_files(),
        data={"backend": "pipeline"},
    )
    assert resp.status_code == 200
    assert resp.json()["markdown"] == "# parsed"

    async with client._transport.app.state.db.session_factory() as session:
        count = await session.scalar(select(func.count()).select_from(TaskRecord))
        assert count == 1


# ---------------------------------------------------------------------------
# T11 -- Idempotency conflict releases cache on IntegrityError
# spec: streaming-upload.md sec 6.3 S11
# ---------------------------------------------------------------------------


async def test_t11_idempotency_conflict_releases_cache(client, api_key):
    """Two concurrent requests with same idempotency key: the losing
    request cleans up its cache directory and returns replay."""
    import asyncio

    from sqlalchemy.exc import IntegrityError
    from mineru_gateway.tasks import service as task_service

    from mineru_gateway.tasks.cache import FileCache

    idem_key = "t11-conflict-key"
    headers = {"X-API-Key": api_key, "X-Idempotency-Key": idem_key}

    original_create = task_service.create
    original_get = task_service.get_by_idempotency_key
    call_count = 0
    lock = asyncio.Lock()
    first_committed = False

    async def fake_get_by_key(session, key_id, key):
        nonlocal call_count
        call_count += 1
        if call_count <= 2:
            return None
        return await original_get(session, key_id, key)

    async def racing_create(session, **fields):
        nonlocal first_committed
        async with lock:
            if first_committed:
                raise IntegrityError(
                    "mock",
                    {},
                    Exception("UNIQUE constraint failed: uq_tasks_key_idempotency"),
                )
            result = await original_create(session, **fields)
            first_committed = True
            return result

    with patch.object(
        task_service, "get_by_idempotency_key", side_effect=fake_get_by_key
    ):
        with patch.object(task_service, "create", side_effect=racing_create):
            with patch.object(
                FileCache, "release", new_callable=AsyncMock
            ) as mock_release:
                mock_release.return_value = None
                r1, r2 = await asyncio.gather(
                    client.post("/tasks", headers=headers, files=_example_files()),
                    client.post("/tasks", headers=headers, files=_example_files()),
                    return_exceptions=True,
                )

    assert not isinstance(r1, Exception), f"r1 raised {r1}"
    assert not isinstance(r2, Exception), f"r2 raised {r2}"
    assert mock_release.call_count == 1

    replayed = [
        r for r in [r1, r2] if r.headers.get("X-Idempotency-Key-Replayed") == "true"
    ]
    assert len(replayed) == 1

    task_ids = [r.json()["task_id"] for r in [r1, r2]]
    assert task_ids[0] == task_ids[1]

    # Only one TaskRecord in DB (spec sec 6.3 S11)
    from sqlalchemy import func, select

    async with client._transport.app.state.db.session_factory() as session:
        count = await session.scalar(select(func.count()).select_from(TaskRecord))
        assert count == 1


# ---------------------------------------------------------------------------
# T16 -- CacheWriter post-close guard
# spec: streaming-upload.md sec 2.1 (write after finish/cancel raises)
# ---------------------------------------------------------------------------


async def test_t16_cache_writer_closed_guard(tmp_path):
    from mineru_gateway.tasks.cache import CacheWriter

    # write_file_chunk after finish
    w = CacheWriter(str(tmp_path))
    await w.finish({})
    with pytest.raises(RuntimeError, match="CacheWriter.*(closed|finished|cancelled)"):
        await w.write_file_chunk("f", "a", "t", b"x")

    # write_file_chunk after cancel
    w2 = CacheWriter(str(tmp_path))
    w2.cancel()
    with pytest.raises(RuntimeError, match="CacheWriter.*(closed|finished|cancelled)"):
        await w2.write_file_chunk("f", "a", "t", b"x")

    # finish after cancel
    w3 = CacheWriter(str(tmp_path))
    w3.cancel()
    with pytest.raises(RuntimeError, match="CacheWriter.*(closed|finished|cancelled)"):
        await w3.finish({})

    # cancel after finish (should not raise)
    w4 = CacheWriter(str(tmp_path))
    await w4.finish({})
    w4.cancel()  # no-op, must not raise


# ---------------------------------------------------------------------------
# T17 -- CacheWriter disk write failure (cleanup on I/O error)
# spec: streaming-upload.md sec 4.2
# ---------------------------------------------------------------------------


async def test_t17_cache_writer_cancel_on_disk_error(tmp_path):
    from mineru_gateway.tasks.cache import CacheWriter

    w = CacheWriter(str(tmp_path))
    await w.write_file_chunk("files", "a.pdf", "application/pdf", b"data")
    cache_dir = w._dir
    assert os.path.isdir(cache_dir)

    # Simulate disk error during finish by mocking aiofiles.open
    with patch("aiofiles.open", side_effect=OSError("disk full")):
        with pytest.raises(OSError, match="disk full"):
            await w.finish({})

    # After error, cancel must still clean up
    w.cancel()
    assert not os.path.isdir(cache_dir), "cancel() must remove dir after disk error"


# ---------------------------------------------------------------------------
# T18 -- Interleaved file and form parts preserve order
# spec: streaming-upload.md sec 1.1 (unchanged invariants: file_names order)
# ---------------------------------------------------------------------------


async def test_t18_interleaved_file_form_parts(tmp_path):
    gen = _make_streaming_app(tmp_path, max_upload_size=100_000)
    async for client, app, settings in gen:
        r = await client.post(
            "/auth/keys",
            json={"label": "t18"},
            headers={"X-Admin-Token": "test-admin-token"},
        )
        api_key = r.json()["api_key"]

        files = [
            ("files", ("first.pdf", b"111", "application/pdf")),
            ("files", ("second.pdf", b"222", "application/pdf")),
        ]
        data = {"backend": "pipeline", "parse_method": "auto"}
        resp = await client.post(
            "/tasks",
            headers={"X-API-Key": api_key},
            files=files,
            data=data,
        )
        assert resp.status_code == 202
        body = resp.json()
        assert body["file_names"] == ["first.pdf", "second.pdf"]

        task_id = uuid.UUID(body["task_id"])
        async with app.state.db.session_factory() as session:
            task = await session.get(TaskRecord, task_id)
            assert task.file_count == 2
            assert task.parse_params.get("parse_method") == "auto"
