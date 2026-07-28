"""E2E tests for health endpoint (Layer 1 - real HTTP with mock upstream).

Verify that the gateway /health endpoint correctly aggregates and
reflects upstream health, and handles upstream unreachability.
"""

from __future__ import annotations

import os
import signal

import httpx
import pytest

from tests.e2e.conftest import _start_gateway, sample_files

# ---------------------------------------------------------------------------
# Default gateway fixture (healthy upstream) - uses e2e_gateway_url
# ---------------------------------------------------------------------------


@pytest.mark.e2e
async def test_health_aggregates_upstream_fields(e2e_client):
    """Health endpoint returns aggregated upstream data over real HTTP.

    1. GET /health -> 200.
    2. Response includes top-level fields (status, gateway) AND a nested
       ``upstream`` object with upstream-level fields (version, free_slots,
       queued_tasks, processing_tasks).
    3. free_slots is non-negative when upstream reports healthy.
    """
    resp = await e2e_client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "healthy"
    upstream = body["upstream"]
    assert "version" in upstream
    assert "free_slots" in upstream
    assert "queued_tasks" in upstream
    assert "processing_tasks" in upstream
    assert upstream["free_slots"] >= 0


# ---------------------------------------------------------------------------
# Custom gateway for upstream-unreachable simulation
# ---------------------------------------------------------------------------


@pytest.mark.e2e
async def test_health_returns_503_when_upstream_unreachable(
    mock_upstream_url, mock_control, tmp_path
):
    """Gateway /health returns 503 when upstream is unreachable.

    1. Make the mock upstream /health raise an error (simulate crash).
    2. GET /health on the gateway -> 503, status field indicates degraded.
    3. Meanwhile POST /tasks (async submission) still succeeds - it is
       not gated by upstream health.
    4. After restoring upstream, /health returns 200 again.
    """
    db = str(tmp_path / "unreach.db")
    cache = str(tmp_path / "unreach_cache")
    os.makedirs(cache, exist_ok=True)
    url, proc = _start_gateway(
        mock_upstream_url,
        db,
        cache,
    )
    try:
        async with httpx.AsyncClient(base_url=url) as c:
            resp = await c.post(
                "/auth/keys",
                json={"label": "e2e-health"},
                headers={"X-Admin-Token": "e2e-admin-token"},
            )
            key = resp.json()["api_key"]
            h = {"X-API-Key": key}

            health = await c.get("/health")
            assert health.status_code == 200

            # Break upstream
            mock_control.set_health_raises()

            degraded = await c.get("/health")
            assert degraded.status_code == 503
            assert degraded.json()["status"] == "degraded"

            # Async submission still works (not health-gated)
            submit = await c.post(
                "/tasks",
                headers=h,
                files=sample_files(),
            )
            assert submit.status_code == 202

            # Restore upstream
            mock_control.reset()

            health2 = await c.get("/health")
            assert health2.status_code == 200
            assert health2.json()["status"] == "healthy"
    finally:
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=5)
