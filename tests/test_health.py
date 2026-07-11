"""Tests for GET /health aggregation.

Spec: mvp-implementation.md §3.3 / §5.1 (健康检查端点), §3.6 (可观测性),
§6.2 步骤2 (健康门控依赖上游 /health).
Plan: Phase 1 — "GET /health 聚合".
"""

from __future__ import annotations

from .mock_upstream import state as mock_state


async def test_health_reports_healthy(client):
    """§3.6: 上游健康时聚合结果为 healthy 且回报 free_slots."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["gateway"] == "healthy"
    assert body["status"] == "healthy"
    assert body["upstream"]["free_slots"] == mock_state.max_concurrent


async def test_health_degraded_when_upstream_unreachable(client):
    """§3.6: 上游不可达时聚合为 degraded, upstream.status=unreachable."""
    mock_state.health_raises = True
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["upstream"]["status"] == "unreachable"


async def test_health_degraded_when_upstream_not_healthy(client):
    """§3.6: 上游可达但非 healthy 状态时, 网关聚合为 degraded."""
    mock_state.status = "overloaded"
    resp = await client.get("/health")
    assert resp.json()["status"] == "degraded"
