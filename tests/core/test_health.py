"""Tests for GET /health aggregation against the MinerU 4.0 V1 payload.

Spec: mvp-implementation.md §3.6 (可观测性), §3.7 (与上游差异对齐).
Plan: Phase 1 — "GET /health 聚合".
"""

from __future__ import annotations

import httpx

from mineru_gateway.upstream.client import UpstreamClient

from tests.mock_upstream import state as mock_state


async def test_health_reports_healthy(client):
    """§3.6: 上游 V1 health 为 ok 时聚合结果为 healthy."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["gateway"] == "healthy"
    assert body["status"] == "healthy"
    assert body["upstream"]["status"] == "healthy"
    assert isinstance(body["upstream"]["features"], dict)


async def test_health_returns_503_when_upstream_unreachable(client):
    """§3.7: 上游不可达时返回 503 (与 mineru-router 保持一致)."""
    mock_state.health_raises = True
    resp = await client.get("/health")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["upstream"]["status"] == "unreachable"


async def test_health_returns_503_when_upstream_not_healthy(client):
    """§3.7: 上游可达但非 ok 状态, 返回 503 (与 mineru-router 保持一致)."""
    mock_state.status = "degraded"
    resp = await client.get("/health")
    assert resp.status_code == 503
    assert resp.json()["status"] == "degraded"


async def test_health_passes_through_v1_fields(client):
    """4.0 health exposes version + capability features, not queue depth."""
    mock_state.version = "4.0.12"
    mock_state.features = {
        "webhook": False,
        "output_formats": ["markdown", "zip"],
        "sources": ["file_id"],
    }
    resp = await client.get("/health")
    assert resp.status_code == 200
    upstream = resp.json()["upstream"]
    assert upstream["version"] == "4.0.12"
    assert upstream["features"]["output_formats"] == ["markdown", "zip"]


async def test_parses_v1_health_payload():
    """The client normalises 4.0's status="ok" into the gateway vocabulary."""

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/health"
        return httpx.Response(
            200,
            json={
                "status": "ok",
                "version": "4.0.12",
                "features": {"output_formats": ["markdown"]},
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://router") as http:
        health = await UpstreamClient(http).get_health()

    assert health.status == "healthy"
    assert health.version == "4.0.12"
    assert health.features == {"output_formats": ["markdown"]}


async def test_degrades_when_v1_health_returns_503():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"status": "degraded", "version": "4.0.12"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://router") as http:
        health = await UpstreamClient(http).get_health()

    assert health.status == "degraded"
