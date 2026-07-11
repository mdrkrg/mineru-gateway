"""Phase 1: task management routes are stubbed (501) but auth still applies."""

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
    resp = await getattr(client, method)(path, headers={"X-API-Key": api_key})
    assert resp.status_code == 501


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/tasks"),
        ("delete", "/tasks/abc"),
    ],
)
async def test_task_routes_require_auth(client, method, path):
    resp = await getattr(client, method)(path)
    assert resp.status_code == 401
