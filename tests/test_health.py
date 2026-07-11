"""Tests for GET /health aggregation."""

from __future__ import annotations

from .mock_upstream import state as mock_state


async def test_health_reports_healthy(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["gateway"] == "healthy"
    assert body["status"] == "healthy"
    assert body["upstream"]["free_slots"] == mock_state.max_concurrent


async def test_health_degraded_when_upstream_unreachable(client):
    mock_state.health_raises = True
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["upstream"]["status"] == "unreachable"


async def test_health_degraded_when_upstream_not_healthy(client):
    mock_state.status = "overloaded"
    resp = await client.get("/health")
    assert resp.json()["status"] == "degraded"
