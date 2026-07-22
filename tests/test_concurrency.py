"""Tests for Phase 4 global concurrency cap.

Spec: mvp-implementation.md §3.5 (全局并发限制: DB 中 pending + processing 上限,
超出 503).
Plan: Phase 4 — "健康感知提交门控 + 全局并发上限".
"""

from __future__ import annotations

import uuid

import httpx
from asgi_lifespan import LifespanManager

from mineru_gateway.config import Settings
from mineru_gateway.main import create_app

from .mock_upstream import create_mock_upstream


async def _client_with_cap(tmp_path, cap):
    settings = Settings(
        upstream_url="http://mock-upstream",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'cap.db'}",
        admin_token="test-admin-token",
        allow_anonymous=False,
        gateway_url="http://testserver",
        file_cache_dir=str(tmp_path / "cache"),
        enable_background=False,
        json_logs=False,
        max_concurrent_tasks=cap,
        create_tables=True,
    )
    upstream = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_mock_upstream()),
        base_url="http://mock-upstream",
    )
    return create_app(settings=settings, upstream_client=upstream)


async def _issue_key(client):
    resp = await client.post(
        "/auth/keys",
        json={"label": "cap"},
        headers={"X-Admin-Token": "test-admin-token"},
    )
    return resp.json()["api_key"]


def _files():
    return [("files", ("doc.pdf", b"%PDF-1.4 data", "application/pdf"))]


async def test_submit_rejected_when_global_cap_reached(tmp_path):
    """§3.5: 在制任务 (pending+processing) 达到上限时新提交返回 503 + Retry-After."""
    app = await _client_with_cap(tmp_path, cap=1)
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            key = await _issue_key(c)
            first = await c.post("/tasks", headers={"X-API-Key": key}, files=_files())
            assert first.status_code == 202

            second = await c.post("/tasks", headers={"X-API-Key": key}, files=_files())
            assert second.status_code == 503
            assert second.headers.get("Retry-After")


async def test_cap_zero_disables_limit(tmp_path):
    """§3.5: max_concurrent_tasks=0 时不限制并发."""
    app = await _client_with_cap(tmp_path, cap=0)
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            key = await _issue_key(c)
            for _ in range(3):
                resp = await c.post(
                    "/tasks", headers={"X-API-Key": key}, files=_files()
                )
                assert resp.status_code == 202


async def test_cap_frees_after_terminal_state(tmp_path):
    """§3.5: 任务进入终态后释放并发额度, 允许新提交."""
    app = await _client_with_cap(tmp_path, cap=1)
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            key = await _issue_key(c)
            first = await c.post("/tasks", headers={"X-API-Key": key}, files=_files())
            task_id = first.json()["task_id"]

            # Cancel the first (pending) task → frees the in-flight slot.
            await c.delete(f"/tasks/{task_id}", headers={"X-API-Key": key})

            second = await c.post("/tasks", headers={"X-API-Key": key}, files=_files())
            assert second.status_code == 202


async def test_retry_pending_task_occupies_slot(tmp_path):
    """§3.5: retry_pending 任务仍占用并发额度 (count_in_flight 计入)."""
    app = await _client_with_cap(tmp_path, cap=1)
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            key = await _issue_key(c)
            first = await c.post("/tasks", headers={"X-API-Key": key}, files=_files())
            task_id = first.json()["task_id"]

        # Move the task into retry_pending directly.
        from mineru_gateway.tasks import service

        async with app.state.db.session_factory() as session:
            await service.update(
                session, uuid.UUID(task_id), {"status": "retry_pending"}
            )

        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            second = await c.post("/tasks", headers={"X-API-Key": key}, files=_files())
            assert second.status_code == 503
