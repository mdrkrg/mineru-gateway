"""E2E tests for edge cases (Layer 1 - real HTTP with mock upstream).

Cover rate-limiting enforcement and CORS preflight behaviour over real
HTTP connections.
"""

from __future__ import annotations

import os
import signal

import httpx
import pytest

from tests.e2e.conftest import _start_gateway, sample_files


@pytest.mark.e2e
async def test_rate_limit_real_http(mock_upstream_url, mock_control, tmp_path):
    """Per-key rate limit enforced at the HTTP layer.

    1. Start a gateway with GATEWAY_RATE_LIMIT_PER_KEY=3 (burst=9).
    2. Issue an API key.
    3. Fire rapid POST /tasks requests - first burst-size requests get
       202; once the token bucket is exhausted the gateway returns 429
       with a Retry-After header.
    """
    db = str(tmp_path / "rl.db")
    cache = str(tmp_path / "rl_cache")
    os.makedirs(cache, exist_ok=True)
    url, proc = _start_gateway(
        mock_upstream_url, db, cache, GATEWAY_RATE_LIMIT_PER_KEY="3"
    )
    try:
        async with httpx.AsyncClient(base_url=url) as c:
            resp = await c.post(
                "/auth/keys",
                json={"label": "e2e-rl"},
                headers={"X-Admin-Token": "e2e-admin-token"},
            )
            key = resp.json()["api_key"]
            h = {"X-API-Key": key}

            files = sample_files()

            hit_429 = False
            for i in range(40):
                r = await c.post("/tasks", headers=h, files=files)
                if r.status_code == 429:
                    hit_429 = True
                    assert r.headers.get("Retry-After") is not None
                    break
                assert r.status_code == 202, (
                    f"unexpected status {r.status_code} at request {i}"
                )
            assert hit_429, "rate limit was never triggered after 40 requests"
    finally:
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=5)


@pytest.mark.e2e
async def test_cors_preflight_real_http(mock_upstream_url, mock_control, tmp_path):
    """CORS preflight returns expected headers over real HTTP.

    1. Start gateway with CORS origin set to https://example.com and
       credentials enabled.
    2. Issue an OPTIONS request to /health with the matching Origin.
    3. Response is 200 with Access-Control-Allow-Origin matching and
       Access-Control-Allow-Credentials: true.
    4. OPTIONS from a different Origin should be rejected (no ACAO or
       wrong value).
    """
    db = str(tmp_path / "cors.db")
    cache = str(tmp_path / "cors_cache")
    os.makedirs(cache, exist_ok=True)
    url, proc = _start_gateway(
        mock_upstream_url,
        db,
        cache,
        GATEWAY_CORS_ALLOW_ORIGINS='["https://example.com"]',
        GATEWAY_CORS_ALLOW_CREDENTIALS="true",
    )
    try:
        async with httpx.AsyncClient(base_url=url) as c:
            # Matching origin
            preflight = await c.options(
                "/health",
                headers={
                    "Origin": "https://example.com",
                    "Access-Control-Request-Method": "GET",
                },
            )
            assert preflight.status_code == 200
            assert (
                preflight.headers.get("Access-Control-Allow-Origin")
                == "https://example.com"
            )
            assert preflight.headers.get("Access-Control-Allow-Credentials") == "true"

            # Non-matching origin
            bad = await c.options(
                "/health",
                headers={
                    "Origin": "https://evil.com",
                    "Access-Control-Request-Method": "GET",
                },
            )
            assert bad.status_code == 400 or (
                bad.headers.get("Access-Control-Allow-Origin") != "https://evil.com"
            )
    finally:
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=5)
