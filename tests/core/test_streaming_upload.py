"""Streaming multipart upload tests for POST /tasks.

Spec: streaming-upload.md sec 6 (Test Scenarios).
Labels T1-T15 map to spec sections S1-S15.
"""

from __future__ import annotations

import contextlib
import json
import os
import tracemalloc
import uuid

import httpx
from asgi_lifespan import LifespanManager

from mineru_gateway.config import Settings
from mineru_gateway.main import create_app
from mineru_gateway.models import TaskRecord

from tests.mock_upstream import create_mock_upstream


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


@contextlib.contextmanager
def _peak_memory_snapshot():
    """Context manager that returns the per-test peak memory delta in bytes."""
    tracemalloc.start()
    tracemalloc.reset_peak()
    before, _ = tracemalloc.get_traced_memory()
    yield
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return  # caller reads last peak value indirectly; we yield delta


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
# T5 -- Large-file memory boundedness (upload stage)
# spec: streaming-upload.md sec 6.2 S5
#
# The gateway process memory during the upload (receive + write to disk)
# must be bounded in constant order, independent of per-file byte size.
# When the stub (full buffering) is active this test will fail because
# the entire file body is held in-memory.  It passes once the real
# streaming parser is implemented.
# ---------------------------------------------------------------------------


async def test_t5_large_file_memory_bounded(tmp_path):
    file_size = 500_000  # 500 KB
    limit = file_size * 4  # well above the file

    gen = _make_streaming_app(tmp_path, max_upload_size=limit)
    async for client, app, settings in gen:
        r = await client.post(
            "/auth/keys",
            json={"label": "t5"},
            headers={"X-Admin-Token": "test-admin-token"},
        )
        api_key = r.json()["api_key"]

        payload = b"x" * file_size
        files = [("files", ("data.bin", payload, "application/octet-stream"))]

        tracemalloc.start()
        tracemalloc.reset_peak()
        before, _ = tracemalloc.get_traced_memory()

        resp = await client.post("/tasks", headers={"X-API-Key": api_key}, files=files)
        assert resp.status_code == 202

        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        delta = peak - before
        # With real streaming, the delta should be a small multiple of chunk
        # size (e.g. < 10 % of file_size).  The stub buffers the entire
        # file (plus CacheWriter bytearray plus restore) so it will fail.
        allowed = int(file_size * 0.30)
        assert delta < allowed, (
            f"memory delta {delta} exceeds {allowed} (30 % of {file_size}); "
            f"streaming may not be active"
        )


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

        # No cache directories left behind
        cache_base = settings.file_cache_dir
        if os.path.isdir(cache_base):
            assert _count_cache_dirs(cache_base) == 0, "orphaned cache dir after 413"

        # No TaskRecord
        from sqlalchemy import func, select

        async with app.state.db.session_factory() as session:
            count = await session.scalar(select(func.count()).select_from(TaskRecord))
            assert count == 0
