"""Tests for GET /health aggregation.

Spec: mvp-implementation.md §3.3 / §5.1 (健康检查端点), §3.6 (可观测性),
§6.2 步骤2 (健康门控依赖上游 /health), §3.7 (与上游差异对齐).
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


async def test_health_returns_503_when_upstream_unreachable(client):
    """§3.7: 上游不可达时返回 503 (与 mineru-router 保持一致)."""
    mock_state.health_raises = True
    resp = await client.get("/health")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["upstream"]["status"] == "unreachable"


async def test_health_returns_503_when_upstream_not_healthy(client):
    """§3.7: 上游可达但非 healthy 状态, 返回 503 (与 mineru-router 保持一致)."""
    mock_state.status = "unhealthy"
    resp = await client.get("/health")
    assert resp.status_code == 503
    assert resp.json()["status"] == "degraded"


async def test_health_passes_through_full_upstream_fields(client):
    """§3.7: 健康上报透传上游的 version / protocol_version / completed_tasks /
    failed_tasks / processing_window_size."""
    mock_state.version = "3.4.0"
    mock_state.protocol_version = 2
    mock_state.completed_tasks = 12
    mock_state.failed_tasks = 1
    mock_state.processing_window_size = 64
    resp = await client.get("/health")
    assert resp.status_code == 200
    upstream = resp.json()["upstream"]
    assert upstream["version"] == "3.4.0"
    assert upstream["protocol_version"] == 2
    assert upstream["completed_tasks"] == 12
    assert upstream["failed_tasks"] == 1
    assert upstream["processing_window_size"] == 64


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
                "protocol_version": 2,
                "queued_tasks": 2,
                "processing_tasks": 5,
                "completed_tasks": 10,
                "failed_tasks": 0,
                "max_concurrent_requests": 24,
                "processing_window_size": 64,
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://router") as http:
        health = await UpstreamClient(http).get_health()

    assert health.status == "healthy"
    assert health.version == "3.4.0"
    assert health.protocol_version == 2
    assert health.max_concurrent == 24
    assert health.queued == 2
    assert health.processing == 5
    assert health.completed == 10
    assert health.failed == 0
    assert health.processing_window_size == 64
    assert health.free_slots == 17
