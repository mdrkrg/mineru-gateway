"""E2E tests against a real MinerU upstream (Layer 2).

These tests require a running `mineru-api` or `mineru-router`
deployment.  Set the environment variable
`GATEWAY_REAL_UPSTREAM_URL` to enable them; otherwise they are
skipped automatically.

Usage:

```sh
GATEWAY_REAL_UPSTREAM_URL=http://mineru-router:8002 \
  uv run pytest tests/e2e/test_real_upstream.py -m real_upstream -v
```
"""

from __future__ import annotations

import os
import signal
import time
from typing import IO

import httpx
import pytest

from tests.e2e.conftest import _start_gateway

_REAL_UPSTREAM_URL = os.environ.get("GATEWAY_REAL_UPSTREAM_URL", "")


def _skip_if_no_real_upstream():
    if not _REAL_UPSTREAM_URL:
        pytest.skip("GATEWAY_REAL_UPSTREAM_URL not set")


# ---------------------------------------------------------------------------
# Shared session fixtures for the real-upstream gateway
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def _real_gateway(tmp_path_factory):
    """Start a gateway pointed at the real MinerU upstream.

    Session-scoped so we reuse the same gateway and API key across
    tests, reducing startup cost when the real upstream is slow.
    """
    _skip_if_no_real_upstream()
    db = str(tmp_path_factory.mktemp("real") / "gateway.db")
    cache = str(tmp_path_factory.mktemp("real_cache"))
    os.makedirs(cache, exist_ok=True)
    url, proc = _start_gateway(
        _REAL_UPSTREAM_URL,
        db,
        cache,
    )
    yield url, proc
    proc.send_signal(signal.SIGTERM)
    proc.wait(timeout=5)


@pytest.fixture(scope="session")
def _real_client(_real_gateway):
    url, _ = _real_gateway
    client = httpx.Client(base_url=url, timeout=120)
    yield client
    client.close()


@pytest.fixture(scope="session")
def _real_key_headers(_real_client):
    """Create one API key and return headers for all real-upstream tests."""
    _skip_if_no_real_upstream()
    resp = _real_client.post(
        "/auth/keys",
        json={"label": "real-e2e"},
        headers={"X-Admin-Token": "e2e-admin-token"},
    )
    assert resp.status_code == 201
    return {"X-API-Key": resp.json()["api_key"]}


def _open_pdf(sample_pdf_path: str) -> tuple[IO[bytes], list[tuple]]:
    """Open *sample_pdf_path* and build httpx files list.

    Returns `(file_handle, files_list)` so the caller can close the
    handle after the test.
    """
    fh = open(sample_pdf_path, "rb")
    return fh, [("files", ("minimal.pdf", fh, "application/pdf"))]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.real_upstream
def test_real_health_fields(_real_client):
    """Verify that the real upstream /health payload is compatible with
    the gateway's `UpstreamHealth` model.

    1. GET /health on the gateway -> 200.
    2. The response includes the expected upstream fields
       (version, max_concurrent_requests, free_slots, queued_tasks,
       processing_tasks) and they have the expected types.
    """
    _skip_if_no_real_upstream()
    resp = _real_client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "healthy"
    assert isinstance(body.get("version"), str)
    assert isinstance(body.get("free_slots"), int)
    assert isinstance(body.get("queued_tasks"), int)
    assert isinstance(body.get("processing_tasks"), int)


@pytest.mark.real_upstream
def test_real_pdf_parse_lifecycle(_real_client, _real_key_headers, sample_pdf_path):
    """Submit a real PDF and verify the full async parse lifecycle.

    1. POST /tasks with real minimal.pdf -> 202 with task_id,
       status_url, result_url.
    2. Poll GET /tasks/{id} until the task reaches a terminal status
       (completed or failed).  Timeout after 120 s.
    3. If completed, GET /tasks/{id}/result -> 200, response body is
       non-empty.
    4. The result content-type is either application/zip or
       application/json (mineru-router output formats).
    """
    _skip_if_no_real_upstream()
    fh, files = _open_pdf(sample_pdf_path)
    try:
        submit = _real_client.post(
            "/tasks",
            headers=_real_key_headers,
            files=files,
            data={"backend": "pipeline"},
        )
        assert submit.status_code == 202, f"submit failed: {submit.text}"
        body = submit.json()
        task_id = body["task_id"]
        assert "status_url" in body
        assert "result_url" in body

        deadline = time.monotonic() + 120
        terminal_status: str | None = None
        while time.monotonic() < deadline:
            detail = _real_client.get(f"/tasks/{task_id}", headers=_real_key_headers)
            assert detail.status_code == 200
            status = detail.json()["status"]
            if status in ("completed", "failed", "cancelled"):
                terminal_status = status
                break
            time.sleep(1)
        assert terminal_status is not None, (
            "task did not reach terminal status within 120s"
        )

        if terminal_status == "completed":
            result = _real_client.get(
                f"/tasks/{task_id}/result", headers=_real_key_headers
            )
            assert result.status_code == 200
            assert len(result.content) > 0

            ct = result.headers.get("content-type", "")
            assert "zip" in ct or "json" in ct or "octet-stream" in ct, (
                f"unexpected content-type: {ct}"
            )
    finally:
        fh.close()


@pytest.mark.real_upstream
def test_real_status_transitions(_real_client, _real_key_headers, sample_pdf_path):
    """Observe upstream status transitions over real HTTP.

    1. Submit a PDF -> 202.
    2. Poll GET /tasks/{id} every second for up to 60 s.
    3. Record the sequence of status values observed.
    4. Verify the transition follows a valid ordered path:
       pending -> processing (optional) -> completed/failed.
       The status should never regress (e.g. completed -> processing).
    """
    _skip_if_no_real_upstream()
    fh, files = _open_pdf(sample_pdf_path)
    try:
        submit = _real_client.post(
            "/tasks",
            headers=_real_key_headers,
            files=files,
            data={"backend": "pipeline"},
        )
        assert submit.status_code == 202
        task_id = submit.json()["task_id"]

        seen: list[str] = []
        terminal = {"completed", "failed", "cancelled"}
        valid_order = {
            "pending": 0,
            "processing": 1,
            "completed": 2,
            "failed": 2,
            "cancelled": 2,
        }

        deadline = time.monotonic() + 60
        last = None
        while time.monotonic() < deadline:
            detail = _real_client.get(f"/tasks/{task_id}", headers=_real_key_headers)
            assert detail.status_code == 200
            status = detail.json()["status"]
            if status != last:
                seen.append(status)
                last = status
            if status in terminal:
                break
            time.sleep(1)

        assert len(seen) >= 2, f"expected at least 2 status transitions, got {seen}"

        # Validate ordering - status index must be non-decreasing
        last_idx = -1
        for s in seen:
            idx = valid_order.get(s)
            assert idx is not None, f"unknown status: {s}"
            assert idx >= last_idx, (
                f"status regressed from index {last_idx} to {idx} ({seen})"
            )
            last_idx = idx

        assert seen[-1] in terminal, f"final status {seen[-1]} not terminal"
    finally:
        fh.close()


@pytest.mark.real_upstream
def test_real_bad_file(_real_client, _real_key_headers):
    """Submit a non-PDF payload and verify the upstream handles it gracefully.

    1. POST /tasks with a plain-text file claiming MIME type
       application/pdf -> 202 (the gateway accepts asynchronously;
       the upstream may still queue it).
    2. Poll GET /tasks/{id} for up to 30 s.
    3. If the upstream rejects the file, the task should eventually
       reach status=failed (not hang forever).
    4. If the gateway or upstream accepts and processes it,
       status=completed is also valid (the upstream might not validate
       content at submission time).
    """
    _skip_if_no_real_upstream()
    files = [
        ("files", ("bad.pdf", b"this is not a PDF file", "application/pdf")),
    ]
    submit = _real_client.post(
        "/tasks",
        headers=_real_key_headers,
        files=files,
        data={"backend": "pipeline"},
    )
    assert submit.status_code == 202
    task_id = submit.json()["task_id"]

    deadline = time.monotonic() + 30
    terminal = {"completed", "failed", "cancelled"}
    status = "pending"
    while time.monotonic() < deadline:
        detail = _real_client.get(f"/tasks/{task_id}", headers=_real_key_headers)
        assert detail.status_code == 200
        status = detail.json()["status"]
        if status in terminal:
            break
        time.sleep(1)

    assert status in terminal, (
        f"task did not reach terminal status within 30s (last: {status})"
    )
