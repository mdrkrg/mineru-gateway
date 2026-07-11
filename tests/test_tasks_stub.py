"""Phase 1: task management routes are stubbed (501) but auth still applies.

Spec: mvp-implementation.md §3.2 / §5.3 (任务管理端点 GET /tasks, GET /tasks/{id},
GET /tasks/{id}/result, DELETE /tasks/{id}).
Plan: 这些端点的完整实现属 Phase 2; Phase 1 仅注册路由并施加 X-API-Key 鉴权,
未实现的业务返回 501.
"""

from __future__ import annotations

import pytest


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/tasks"),
        ("get", "/tasks/abc"),
        ("get", "/tasks/abc/result"),
        ("delete", "/tasks/abc"),
    ],
)
async def test_task_routes_stubbed(client, api_key, method, path):
    """Phase 2 端点在 Phase 1 为占位实现 — 认证通过后返回 501 (未实现)."""
    resp = await getattr(client, method)(path, headers={"X-API-Key": api_key})
    assert resp.status_code == 501


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/tasks"),
        ("get", "/tasks/abc"),
        ("get", "/tasks/abc/result"),
        ("delete", "/tasks/abc"),
    ],
)
async def test_task_routes_require_auth(client, method, path):
    """§3.2: 所有任务端点需要 X-API-Key — 缺失时 401 (鉴权先于业务/501)."""
    resp = await getattr(client, method)(path)
    assert resp.status_code == 401
