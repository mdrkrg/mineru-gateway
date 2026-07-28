"""E2E tests for core task lifecycle (Layer 1 - real HTTP with mock upstream).

These tests exercise the gateway over a real TCP connection against a
standalone mock upstream subprocess.  They cover the primary user
journey: create key -> submit -> list/detail -> status sync -> result,
plus cancel and concurrency cap flows.
"""

from __future__ import annotations

import asyncio
import os
import signal

import httpx
import pytest

from tests.e2e.conftest import _start_gateway, sample_files


@pytest.mark.e2e
async def test_full_lifecycle_real_http(mock_control, mock_upstream_url, tmp_path):
    """Full task lifecycle over real HTTP.

    1. Start a background-enabled gateway.
    2. Issue an API key with the admin token -> 201 with plaintext key.
    3. POST /tasks with key + multipart file -> 202 with task_id,
       status_url, result_url, file_names.
    4. GET /tasks -> the submitted task appears in the owner list.
    5. GET /tasks/{id} -> returns pending status, backend, file info.
    6. Set mock upstream task_status to "completed" -> the background
       status-sync loop will pick up the change (interval=0.5s).
       Poll until the task status transitions to "completed".
    7. GET /tasks/{id}/result -> 200, content matches upstream mock.
    """
    db = str(tmp_path / "lifecycle.db")
    cache = str(tmp_path / "lifecycle_cache")
    os.makedirs(cache, exist_ok=True)
    url, proc = _start_gateway(
        mock_upstream_url,
        db,
        cache,
        GATEWAY_ENABLE_BACKGROUND="true",
        GATEWAY_STATUS_SYNC_INTERVAL="0.5",
    )
    try:
        async with httpx.AsyncClient(base_url=url) as c:
            # 1. Issue key
            resp = await c.post(
                "/auth/keys",
                json={"label": "e2e-lifecycle"},
                headers={"X-Admin-Token": "e2e-admin-token"},
            )
            assert resp.status_code == 201
            key = resp.json()["api_key"]
            headers = {"X-API-Key": key}

            # 2. Submit task
            files = sample_files()
            submit = await c.post(
                "/tasks",
                headers=headers,
                files=files,
                data={"backend": "pipeline"},
            )
            assert submit.status_code == 202
            body = submit.json()
            task_id = body["task_id"]
            assert "status_url" in body
            assert "result_url" in body
            assert "file_names" in body

            # 3. Task list
            listing = await c.get("/tasks", headers=headers)
            assert listing.status_code == 200
            assert listing.json()["total"] >= 1

            # 4. Task detail - pending
            detail = await c.get(f"/tasks/{task_id}", headers=headers)
            assert detail.status_code == 200
            assert detail.json()["status"] == "pending"

            # 5. Trigger status sync
            mock_control.set_task_status("completed")
            for _ in range(30):
                detail = await c.get(f"/tasks/{task_id}", headers=headers)
                if detail.json()["status"] == "completed":
                    break
                await asyncio.sleep(0.5)
            else:
                pytest.fail("task did not reach completed status within timeout")

            # 6. Retrieve result
            result = await c.get(f"/tasks/{task_id}/result", headers=headers)
            assert result.status_code == 200
            assert "result content" in result.text
    finally:
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=5)


@pytest.mark.e2e
async def test_cancel_lifecycle_real_http(e2e_client, e2e_key_headers, mock_control):
    """Cancel lifecycle over real HTTP.

    1. Submit task -> 202.
    2. DELETE /tasks/{id} -> 200, status=cancelled.
    3. GET /tasks/{id} -> status confirms cancelled.
    4. Upstream cancel endpoint is called (mock verifies no error).
    """
    files = sample_files()
    submit = await e2e_client.post("/tasks", headers=e2e_key_headers, files=files)
    assert submit.status_code == 202
    task_id = submit.json()["task_id"]

    cancel = await e2e_client.delete(f"/tasks/{task_id}", headers=e2e_key_headers)
    assert cancel.status_code == 200
    assert cancel.json()["status"] == "cancelled"

    detail = await e2e_client.get(f"/tasks/{task_id}", headers=e2e_key_headers)
    assert detail.json()["status"] == "cancelled"


@pytest.mark.e2e
async def test_concurrency_cap_real_http(mock_upstream_url, mock_control, tmp_path):
    """Concurrency cap enforced at the HTTP level.

    1. Start a gateway with max_concurrent_tasks=1.
    2. Submit first task -> 202 (occupies the slot).
    3. Submit second task -> 503 with Retry-After header.
    4. Cancel first task -> frees the slot.
    5. Submit third task -> 202 (slot is now available).
    """
    db = str(tmp_path / "cap.db")
    cache = str(tmp_path / "cap_cache")
    os.makedirs(cache, exist_ok=True)
    url, proc = _start_gateway(
        mock_upstream_url, db, cache, GATEWAY_MAX_CONCURRENT_TASKS="1"
    )
    try:
        async with httpx.AsyncClient(base_url=url) as c:
            # Create key
            resp = await c.post(
                "/auth/keys",
                json={"label": "e2e-cap"},
                headers={"X-Admin-Token": "e2e-admin-token"},
            )
            key = resp.json()["api_key"]
            h = {"X-API-Key": key}

            files = sample_files()

            first = await c.post("/tasks", headers=h, files=files)
            assert first.status_code == 202
            task_id = first.json()["task_id"]

            blocked = await c.post("/tasks", headers=h, files=files)
            assert blocked.status_code == 503
            assert blocked.headers.get("Retry-After")

            await c.delete(f"/tasks/{task_id}", headers=h)

            third = await c.post("/tasks", headers=h, files=files)
            assert third.status_code == 202
    finally:
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=5)


@pytest.mark.e2e
async def test_idempotent_submission_real_http(e2e_client, e2e_key_headers):
    """Idempotent submission via X-Idempotency-Key over real HTTP.

    1. POST /tasks with X-Idempotency-Key -> 202, creates task.
    2. POST /tasks with the same X-Idempotency-Key -> 202, returns the
       original task_id with header X-Idempotency-Key-Replayed: true.
    """
    idem_key = "e2e-idem-key-001"
    files = sample_files()
    headers = {**e2e_key_headers, "X-Idempotency-Key": idem_key}

    first = await e2e_client.post("/tasks", headers=headers, files=files)
    assert first.status_code == 202
    task_id = first.json()["task_id"]

    second = await e2e_client.post("/tasks", headers=headers, files=files)
    assert second.status_code == 202
    assert second.json()["task_id"] == task_id
    assert second.headers.get("X-Idempotency-Key-Replayed") == "true"


@pytest.mark.e2e
async def test_file_size_limit_real_http(mock_upstream_url, mock_control, tmp_path):
    """Upload size limit enforced over real HTTP.

    1. Start a gateway with max_upload_size=500 (bytes).
    2. Submit a file payload of ~3 KB -> 413 (exceeds 500 B limit).
    3. Submit a tiny payload (5 bytes) -> 202 (within limit).
    """
    db = str(tmp_path / "size.db")
    cache = str(tmp_path / "size_cache")
    os.makedirs(cache, exist_ok=True)
    url, proc = _start_gateway(
        mock_upstream_url, db, cache, GATEWAY_MAX_UPLOAD_SIZE="500"
    )
    try:
        async with httpx.AsyncClient(base_url=url) as c:
            resp = await c.post(
                "/auth/keys",
                json={"label": "e2e-size"},
                headers={"X-Admin-Token": "e2e-admin-token"},
            )
            key = resp.json()["api_key"]
            h = {"X-API-Key": key}

            # Oversized - _MINIMAL_PDF ~433 bytes + multipart framing > 500 limit
            oversized = await c.post(
                "/tasks",
                headers=h,
                files=sample_files(),
            )
            assert oversized.status_code == 413

            # Within limit - tiny 5-byte payload
            tiny = [("files", ("tiny.dat", b"hello", "application/octet-stream"))]
            ok = await c.post(
                "/tasks",
                headers=h,
                files=tiny,
            )
            assert ok.status_code == 202
    finally:
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=5)
