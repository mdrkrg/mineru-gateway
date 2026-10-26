"""E2E tests against the configured or mock MinerU upstream (Layer 2).

When the `real_upstream` marker is explicitly selected, the tests read the
deployment's `GATEWAY_UPSTREAM_URL` and `GATEWAY_UPSTREAM_API_KEY` from `.env`
through `Settings` and require that service. Otherwise they use the shared mock
upstream so the same scenarios remain part of the default hermetic suite.

Usage:

```sh
# Against the upstream configured in .env
uv run pytest tests/e2e/test_real_upstream.py -m real_upstream -v

# Against mock (default suite / no marker)
uv run pytest tests/e2e/ -v
```
"""

from __future__ import annotations

import os
import signal
import time
from pathlib import Path
from typing import IO

import httpx
import pytest

from mineru_gateway.config import Settings

from tests.e2e.conftest import _start_gateway

_ROOT = Path(__file__).resolve().parents[2]
_ENV_FILE = _ROOT / ".env"


def _real_upstream_settings(pytestconfig: pytest.Config) -> Settings | None:
    """Resolve the deployment settings only for an explicit real run.

    The marker check keeps the default suite hermetic: only an explicit
    ``-m real_upstream`` run touches the configured service. Reading through
    ``Settings`` preserves the normal `GATEWAY_*` precedence instead of
    parsing the file or a single environment variable by hand.
    """
    if "real_upstream" not in (pytestconfig.getoption("markexpr") or ""):
        return None
    if not _ENV_FILE.is_file():
        raise pytest.UsageError(
            "real_upstream tests require GATEWAY_UPSTREAM_URL in .env"
        )
    settings = Settings(_env_file=_ENV_FILE)
    if not str(settings.upstream_url).strip():
        raise pytest.UsageError(
            "real_upstream tests require GATEWAY_UPSTREAM_URL in .env"
        )
    return settings


# ---------------------------------------------------------------------------
# Shared session fixtures — explicitly real, otherwise mock
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def _real_gateway(tmp_path_factory, pytestconfig, request):
    """Start a gateway against the required real upstream or the mock suite.

    Session-scoped so we reuse the same gateway and API key across
    tests, reducing startup cost when the real upstream is slow.
    """
    real_settings = _real_upstream_settings(pytestconfig)
    if real_settings is None:
        upstream_url = request.getfixturevalue("mock_upstream_url")
        upstream_api_key = ""
    else:
        upstream_url = str(real_settings.upstream_url)
        upstream_api_key = real_settings.upstream_api_key
    db = str(tmp_path_factory.mktemp("real") / "gateway.db")
    cache = str(tmp_path_factory.mktemp("real_cache"))
    os.makedirs(cache, exist_ok=True)
    url, proc = _start_gateway(
        upstream_url,
        db,
        cache,
        GATEWAY_ENABLE_BACKGROUND="true",
        GATEWAY_STATUS_SYNC_INTERVAL="1",
        GATEWAY_UPSTREAM_API_KEY=upstream_api_key,
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
    """Create one API key and return headers for all tests."""
    resp = _real_client.post(
        "/auth/keys",
        json={"label": "real-e2e"},
        headers={"X-Admin-Token": "e2e-admin-token"},
    )
    assert resp.status_code == 201
    return {"X-API-Key": resp.json()["api_key"]}


@pytest.fixture
def _upstream_control(pytestconfig, request):
    """Expose mock controls only during the default hermetic run."""
    if _real_upstream_settings(pytestconfig) is not None:
        return None
    return request.getfixturevalue("mock_control")


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
    2. The top-level `status` is `"healthy"` when upstream is ok.
    3. The nested `upstream` object contains the 4.0 fields
       (version, features) with the correct types.
    """
    resp = _real_client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "healthy"
    upstream = body["upstream"]
    assert isinstance(upstream.get("version"), str)
    assert isinstance(upstream["features"], dict)


@pytest.mark.real_upstream
def test_real_pdf_parse_lifecycle(
    _real_client, _real_key_headers, sample_pdf_path, _upstream_control
):
    """Submit a real PDF and verify the full async parse lifecycle.

    1. POST /tasks with real minimal.pdf -> 202 with task_id,
       status_url, result_url.
    2. Poll GET /tasks/{id} until the task reaches a terminal status
       (completed, partial or failed).  Timeout after 120 s.
    3. Require a downloadable terminal state and GET /tasks/{id}/result ->
       200 with a non-empty body.
    4. The result content-type is either application/zip or
       application/json (mineru-router output formats).
    """
    fh, files = _open_pdf(sample_pdf_path)
    try:
        submit = _real_client.post(
            "/tasks",
            headers=_real_key_headers,
            files=files,
            data={"tier": "basic", "output_formats": "markdown,zip"},
        )
        assert submit.status_code == 202, f"submit failed: {submit.text}"
        body = submit.json()
        task_id = body["task_id"]
        assert "status_url" in body
        assert "result_url" in body

        if _upstream_control is not None:
            _upstream_control.set_task_status("completed")
            _upstream_control.configure(result_content_type="application/zip")

        deadline = time.monotonic() + 120
        terminal_status: str | None = None
        while time.monotonic() < deadline:
            detail = _real_client.get(f"/tasks/{task_id}", headers=_real_key_headers)
            assert detail.status_code == 200
            status = detail.json()["status"]
            if status in ("completed", "partial", "failed", "cancelled"):
                terminal_status = status
                break
            time.sleep(1)
        assert terminal_status is not None, (
            "task did not reach terminal status within 120s"
        )

        assert terminal_status in {"completed", "partial"}, (
            f"task did not produce a downloadable result: {terminal_status}"
        )
        result = _real_client.get(f"/tasks/{task_id}/result", headers=_real_key_headers)
        assert result.status_code == 200
        assert len(result.content) > 0

        ct = result.headers.get("content-type", "")
        assert "zip" in ct or "json" in ct or "octet-stream" in ct, (
            f"unexpected content-type: {ct}"
        )
    finally:
        fh.close()


@pytest.mark.real_upstream
def test_real_status_transitions(
    _real_client, _real_key_headers, sample_pdf_path, _upstream_control
):
    """Observe upstream status transitions over real HTTP.

    1. Submit a PDF -> 202.
    2. Poll GET /tasks/{id} every second for up to 60 s.
    3. Record the sequence of status values observed.
    4. Verify the transition follows a valid ordered path:
       pending -> processing (optional) -> completed/failed.
       The status should never regress (e.g. completed -> processing).
    """
    fh, files = _open_pdf(sample_pdf_path)
    try:
        submit = _real_client.post(
            "/tasks",
            headers=_real_key_headers,
            files=files,
            data={"tier": "basic"},
        )
        assert submit.status_code == 202
        task_id = submit.json()["task_id"]

        if _upstream_control is not None:
            _upstream_control.set_task_status("completed")

        seen: list[str] = []
        terminal = {"completed", "partial", "failed", "cancelled"}
        valid_order = {
            "pending": 0,
            "processing": 1,
            "completed": 2,
            "partial": 2,
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

        assert len(seen) >= 1, f"expected at least 1 status update, got {seen}"

        # Validate ordering - status index must be non-decreasing.
        # Accept that the task might complete before our first poll,
        # so seen=['completed'] is valid too.
        if len(seen) >= 2:
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
       application/pdf.
    2. Two possible outcomes are valid:
       a) Gateway returns 202 (upstream queued it - mock behaviour, or
          upstream that doesn't validate content at submission time).
          In this case, poll GET /tasks/{id} up to 30 s; the task
          should reach a terminal status (completed/failed/cancelled)
          rather than hang forever.
       b) Gateway returns a non-202 status (upstream rejected the file
          immediately - real mineru-router behaviour).  This is also
          a valid graceful handling of bad input.
    """
    files = [
        ("files", ("bad.pdf", b"this is not a PDF file", "application/pdf")),
    ]
    submit = _real_client.post(
        "/tasks",
        headers=_real_key_headers,
        files=files,
        data={"tier": "basic"},
    )
    # A strict upstream rejects unsupported file types. A permissive
    # deployment may accept the upload and fail the task asynchronously.
    if submit.status_code != 202:
        assert submit.status_code in {400, 415, 422}, (
            f"unexpected rejection status: {submit.status_code} {submit.text}"
        )
        return

    task_id = submit.json()["task_id"]

    deadline = time.monotonic() + 30
    terminal = {"completed", "partial", "failed", "cancelled"}
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
