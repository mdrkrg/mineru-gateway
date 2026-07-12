"""End-to-end integration test covering the full task lifecycle.

Spec: mvp-implementation.md — exercises auth (§3.1), submit + record (§3.3/§6.2),
list/detail/result (§3.2/§5.1), status sync (§6.3), and cancel (§5.3) together
against the in-process mock upstream.
Plan: Phase 4 — "端到端集成测试".
"""

from __future__ import annotations

import httpx
from asgi_lifespan import LifespanManager

from mineru_gateway.background import status_sync
from mineru_gateway.config import Settings
from mineru_gateway.main import create_app
from mineru_gateway.upstream.client import UpstreamClient

from .mock_upstream import create_mock_upstream, state as mock_state


async def test_full_lifecycle(client, admin_headers, app, upstream_client):
    # 1. Issue an API key with the admin token.
    key = (
        await client.post("/auth/keys", json={"label": "e2e"}, headers=admin_headers)
    ).json()["api_key"]
    headers = {"X-API-Key": key}

    # 2. Submit an async task.
    files = [("files", ("doc.pdf", b"%PDF-1.4 e2e", "application/pdf"))]
    submit = await client.post(
        "/tasks", headers=headers, files=files, data={"backend": "pipeline"}
    )
    assert submit.status_code == 202
    task_id = submit.json()["task_id"]

    # 3. It appears in the owner's task list and detail.
    listing = await client.get("/tasks", headers=headers)
    assert listing.json()["total"] == 1
    detail = await client.get(f"/tasks/{task_id}", headers=headers)
    assert detail.json()["status"] == "pending"

    # 4. Background status sync mirrors upstream completion into the DB.
    mock_state.task_status = "completed"
    await status_sync.sync_once(
        app.state.db, UpstreamClient(upstream_client), poll_failure_threshold=3
    )
    detail = await client.get(f"/tasks/{task_id}", headers=headers)
    assert detail.json()["status"] == "completed"

    # 5. Result is streamed back from upstream.
    result = await client.get(f"/tasks/{task_id}/result", headers=headers)
    assert result.status_code == 200
    assert "result content" in result.text


async def test_cancel_lifecycle(client, admin_headers):
    key = (
        await client.post("/auth/keys", json={"label": "e2e2"}, headers=admin_headers)
    ).json()["api_key"]
    headers = {"X-API-Key": key}

    files = [("files", ("doc.pdf", b"%PDF-1.4 e2e", "application/pdf"))]
    task_id = (await client.post("/tasks", headers=headers, files=files)).json()[
        "task_id"
    ]

    cancel = await client.delete(f"/tasks/{task_id}", headers=headers)
    assert cancel.status_code == 200
    assert cancel.json()["status"] == "cancelled"

    detail = await client.get(f"/tasks/{task_id}", headers=headers)
    assert detail.json()["status"] == "cancelled"


async def test_protected_lifecycle_with_concurrency_cap(tmp_path):
    """Phase 4 e2e: 带全局并发上限的完整链路 — 提交占满额度 → 二次提交 503 →
    取消释放 → 三次提交成功 (§3.5)."""
    settings = Settings(
        upstream_url="http://mock-upstream",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'e2e-cap.db'}",
        admin_token="test-admin-token",
        allow_anonymous=False,
        gateway_url="http://testserver",
        file_cache_dir=str(tmp_path / "cache"),
        enable_background=False,
        json_logs=False,
        max_concurrent_tasks=1,
    )
    upstream = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_mock_upstream()),
        base_url="http://mock-upstream",
    )
    app = create_app(settings=settings, upstream_client=upstream)
    files = [("files", ("doc.pdf", b"%PDF-1.4 e2e", "application/pdf"))]

    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            key = (
                await c.post(
                    "/auth/keys",
                    json={"label": "e2e-cap"},
                    headers={"X-Admin-Token": "test-admin-token"},
                )
            ).json()["api_key"]
            headers = {"X-API-Key": key}

            first = await c.post("/tasks", headers=headers, files=files)
            assert first.status_code == 202
            task_id = first.json()["task_id"]

            # Cap reached → next submission is rejected.
            blocked = await c.post("/tasks", headers=headers, files=files)
            assert blocked.status_code == 503
            assert blocked.headers.get("Retry-After")

            # Cancel frees the slot → subsequent submission succeeds.
            await c.delete(f"/tasks/{task_id}", headers=headers)
            third = await c.post("/tasks", headers=headers, files=files)
            assert third.status_code == 202
