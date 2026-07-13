"""Tests for GET /health aggregation.

Spec: mvp-implementation.md §3.3 / §5.1 (健康检查端点), §3.6 (可观测性),
§6.2 步骤2 (健康门控依赖上游 /health).
Plan: Phase 1 — "GET /health 聚合".
"""

from __future__ import annotations

import httpx

from mineru_gateway.upstream.client import UpstreamClient

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


async def test_parses_real_router_health_field_names():
    """§6.2 步骤2: 兼容 mineru-router v3.4.0 的 /health 字段名.

    真实 router 用 max_concurrent_requests / queued_tasks / processing_tasks
    (而非 max_concurrent / queued / processing)。回归测试: 若客户端读错字段,
    free_slots 会退化为 0, 使门控 503 掉所有提交。
    """

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "status": "healthy",
                "version": "3.4.0",
                "queued_tasks": 2,
                "processing_tasks": 5,
                "max_concurrent_requests": 24,
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://router") as http:
        health = await UpstreamClient(http).get_health()

    assert health.status == "healthy"
    assert health.max_concurrent == 24
    assert health.queued == 2
    assert health.processing == 5
    assert health.free_slots == 17
