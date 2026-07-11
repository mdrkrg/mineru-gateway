"""Tests for authenticated + anonymous proxying of POST /tasks and /file_parse."""

from __future__ import annotations

import pytest

from mineru_gateway.config import Settings
from mineru_gateway.main import create_app
from asgi_lifespan import LifespanManager
import httpx

from .mock_upstream import create_mock_upstream, state as mock_state


async def test_submit_requires_key_when_anonymous_disabled(client, sample_files):
    resp = await client.post("/tasks", files=sample_files)
    assert resp.status_code == 401


async def test_submit_authenticated_creates_task_and_superset_response(
    client, api_key, sample_files
):
    resp = await client.post(
        "/tasks", headers={"X-API-Key": api_key}, files=sample_files
    )
    assert resp.status_code == 202
    body = resp.json()
    # Gateway id replaces upstream id, superset fields added.
    assert body["task_id"]
    assert body["status"] == "pending"
    assert body["status_url"].endswith(f"/tasks/{body['task_id']}")
    assert body["result_url"].endswith(f"/tasks/{body['task_id']}/result")
    assert body["file_names"] == ["doc.pdf"]
    # Compatibility response headers present.
    assert resp.headers["X-MinerU-Task-Id"] == body["task_id"]


async def test_submit_records_parse_parameters(client, api_key, sample_files):
    resp = await client.post(
        "/tasks",
        headers={"X-API-Key": api_key},
        files=sample_files,
        data={
            "backend": "pipeline",
            "formula_enable": "true",
            "table_enable": "0",
            "start_page_id": "2",
            "lang_list": "en,ch",
        },
    )
    assert resp.status_code == 202
    task_id = resp.json()["task_id"]

    from mineru_gateway.models import TaskRecord

    async with client._transport.app.state.db.session_factory() as session:
        task = await session.get(TaskRecord, task_id)
        assert task.backend == "pipeline"
        assert task.formula_enable is True
        assert task.table_enable is False
        assert task.start_page_id == 2
        assert task.lang_list == ["en", "ch"]


async def test_submit_rejects_when_total_exceeds_max_size(
    client, admin_headers, sample_files
):
    # Issue a key on an app whose settings we can inspect; use the shared app but
    # drive many files so the cumulative size trips the per-request limit.
    raw = (
        await client.post("/auth/keys", json={"label": "sz"}, headers=admin_headers)
    ).json()["api_key"]
    max_size = client._transport.app.state.settings.max_upload_size
    half = b"x" * (max_size // 2 + 1)
    files = [
        ("files", ("a.pdf", half, "application/pdf")),
        ("files", ("b.pdf", half, "application/pdf")),
    ]
    resp = await client.post("/tasks", headers={"X-API-Key": raw}, files=files)
    assert resp.status_code == 413


async def test_submit_upstream_non_202_surfaces_error(client, api_key, sample_files):
    mock_state.submit_status = 500
    resp = await client.post(
        "/tasks", headers={"X-API-Key": api_key}, files=sample_files
    )
    assert resp.status_code == 500


async def test_submit_503_when_no_free_slots(client, api_key, sample_files):
    mock_state.processing = mock_state.max_concurrent
    resp = await client.post(
        "/tasks", headers={"X-API-Key": api_key}, files=sample_files
    )
    assert resp.status_code == 503
    assert resp.headers.get("Retry-After") == "5"


async def test_file_parse_authenticated_relays_result(client, api_key, sample_files):
    resp = await client.post(
        "/file_parse", headers={"X-API-Key": api_key}, files=sample_files
    )
    assert resp.status_code == 200
    assert resp.json()["markdown"] == "# parsed"


async def test_file_parse_requires_key_when_anonymous_disabled(client, sample_files):
    resp = await client.post("/file_parse", files=sample_files)
    assert resp.status_code == 401


async def test_file_parse_503_when_no_free_slots(client, api_key, sample_files):
    mock_state.processing = mock_state.max_concurrent
    resp = await client.post(
        "/file_parse", headers={"X-API-Key": api_key}, files=sample_files
    )
    assert resp.status_code == 503
    assert resp.headers.get("Retry-After") == "5"


async def test_file_parse_rejects_when_total_exceeds_max_size(client, api_key):
    max_size = client._transport.app.state.settings.max_upload_size
    files = [("files", ("big.pdf", b"x" * (max_size + 1), "application/pdf"))]
    resp = await client.post(
        "/file_parse", headers={"X-API-Key": api_key}, files=files
    )
    assert resp.status_code == 413


async def test_file_parse_429_when_rate_limited(client, admin_headers, sample_files):
    raw = (
        await client.post("/auth/keys", json={"label": "fp-rl"}, headers=admin_headers)
    ).json()["api_key"]
    hit_429 = False
    for _ in range(40):
        resp = await client.post(
            "/file_parse", headers={"X-API-Key": raw}, files=sample_files
        )
        if resp.status_code == 429:
            hit_429 = True
            assert resp.headers.get("Retry-After") == "60"
            break
    assert hit_429


# --- Anonymous mode (ALLOW_ANONYMOUS=true): pure passthrough, no task record ---


async def _anon_client(tmp_path):
    settings = Settings(
        upstream_url="http://mock-upstream",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'anon.db'}",
        admin_token="test-admin-token",
        allow_anonymous=True,
        gateway_url="http://testserver",
    )
    upstream = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_mock_upstream()),
        base_url="http://mock-upstream",
    )
    app = create_app(settings=settings, upstream_client=upstream)
    return app, settings


async def test_anonymous_passthrough_no_record(tmp_path):
    app, settings = await _anon_client(tmp_path)
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            files = [("files", ("a.pdf", b"data", "application/pdf"))]
            resp = await c.post("/tasks", files=files)
            # Pure passthrough: upstream 202 body relayed (upstream task_id kept).
            assert resp.status_code == 202
            assert resp.json()["task_id"].startswith("up-")

        # No task rows written for anonymous requests.
        from sqlalchemy import func, select
        from mineru_gateway.models import TaskRecord

        async with app.state.db.session_factory() as session:
            count = await session.scalar(select(func.count()).select_from(TaskRecord))
            assert count == 0
