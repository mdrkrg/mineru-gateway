"""Tests for Phase 2 task management: list, detail, result, cancel.

Spec: mvp-implementation.md §3.2 (任务管理), §5.1 (GET /tasks/{id} 返回 DB 镜像状态,
GET /tasks/{id}/result 流式透传), §5.3 (GET /tasks 分页/筛选, DELETE /tasks/{id}),
§4 (TaskRecord), §3.3 (所有权隔离).
Plan: Phase 2 — "认证请求任务写入 DB; GET /tasks/{id} 权限校验 + 状态代理;
GET /tasks 列表 (分页、筛选); DELETE /tasks/{id} 取消".
"""

from __future__ import annotations

from datetime import date, timedelta

from .mock_upstream import state as mock_state


async def _submit(client, api_key, data=None):
    files = [("files", ("doc.pdf", b"%PDF-1.4 data", "application/pdf"))]
    resp = await client.post(
        "/tasks", headers={"X-API-Key": api_key}, files=files, data=data or {}
    )
    assert resp.status_code == 202, resp.text
    return resp.json()["task_id"]


# ===== GET /tasks/{id} — detail + ownership (§3.2, §5.1) =====


async def test_get_task_detail_returns_db_state(client, api_key):
    """§5.1: 先校验所有权, 返回该任务的 DB 镜像状态 + 文件列表 + 时间戳."""
    task_id = await _submit(client, api_key)
    resp = await client.get(f"/tasks/{task_id}", headers={"X-API-Key": api_key})
    assert resp.status_code == 200
    body = resp.json()
    assert body["task_id"] == task_id
    assert body["status"] == "pending"
    assert body["file_names"] == ["doc.pdf"]
    assert body["file_count"] == 1
    assert "created_at" in body
    assert body["retry_count"] == 0


async def test_get_task_detail_unknown_id_404(client, api_key):
    """§3.2: 不存在的任务返回 404."""
    resp = await client.get("/tasks/does-not-exist", headers={"X-API-Key": api_key})
    assert resp.status_code == 404


async def test_get_task_detail_enforces_ownership(client, admin_headers, api_key):
    """§3.3: 另一个 Key 不能查看不属于自己的任务 (404, 不泄露存在性)."""
    task_id = await _submit(client, api_key)
    other = (
        await client.post("/auth/keys", json={"label": "other"}, headers=admin_headers)
    ).json()["api_key"]
    resp = await client.get(f"/tasks/{task_id}", headers={"X-API-Key": other})
    assert resp.status_code == 404


async def test_get_task_detail_requires_auth(client, api_key):
    """§3.2: 未带 Key 访问详情被拒 (401)."""
    task_id = await _submit(client, api_key)
    resp = await client.get(f"/tasks/{task_id}")
    assert resp.status_code == 401


# ===== GET /tasks — list, filter, pagination (§3.2, §5.3) =====


async def test_list_only_returns_own_tasks(client, admin_headers, api_key):
    """§3.3: 列表仅返回当前 Key 拥有的任务."""
    await _submit(client, api_key)
    await _submit(client, api_key)
    other = (
        await client.post("/auth/keys", json={"label": "o2"}, headers=admin_headers)
    ).json()["api_key"]
    await _submit(client, other)

    resp = await client.get("/tasks", headers={"X-API-Key": api_key})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert len(body["items"]) == 2
    assert all("task_id" in it for it in body["items"])


async def test_list_filter_by_status(client, api_key):
    """§5.3: 支持按 status 筛选."""
    await _submit(client, api_key)
    resp = await client.get(
        "/tasks", headers={"X-API-Key": api_key}, params={"status": "completed"}
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 0

    resp = await client.get(
        "/tasks", headers={"X-API-Key": api_key}, params={"status": "pending"}
    )
    assert resp.json()["total"] == 1


async def test_list_filter_by_backend(client, api_key):
    """§5.3: 支持按 backend 筛选."""
    await _submit(client, api_key, data={"backend": "pipeline"})
    await _submit(client, api_key, data={"backend": "vlm"})
    resp = await client.get(
        "/tasks", headers={"X-API-Key": api_key}, params={"backend": "vlm"}
    )
    assert resp.json()["total"] == 1


async def test_list_filter_by_file_name_fuzzy(client, api_key):
    """§5.3: file_name 为模糊搜索."""
    files = [("files", ("report_2024.pdf", b"data", "application/pdf"))]
    await client.post("/tasks", headers={"X-API-Key": api_key}, files=files)
    resp = await client.get(
        "/tasks", headers={"X-API-Key": api_key}, params={"file_name": "report"}
    )
    assert resp.json()["total"] == 1
    resp = await client.get(
        "/tasks", headers={"X-API-Key": api_key}, params={"file_name": "invoice"}
    )
    assert resp.json()["total"] == 0


async def test_list_filter_by_date_range(client, api_key):
    """§5.3: 支持按 date_from/date_to 过滤 (ISO date)."""
    await _submit(client, api_key)
    today = date.today().isoformat()
    future = (date.today() + timedelta(days=1)).isoformat()
    past = (date.today() - timedelta(days=1)).isoformat()

    # Today's task falls within [past, today].
    resp = await client.get(
        "/tasks",
        headers={"X-API-Key": api_key},
        params={"date_from": past, "date_to": today},
    )
    assert resp.json()["total"] == 1

    # A future-only window excludes it.
    resp = await client.get(
        "/tasks",
        headers={"X-API-Key": api_key},
        params={"date_from": future},
    )
    assert resp.json()["total"] == 0


async def test_list_pagination(client, api_key):
    """§5.3: 分页 page/page_size; total 反映全量, items 受页大小限制."""
    for _ in range(5):
        await _submit(client, api_key)
    resp = await client.get(
        "/tasks",
        headers={"X-API-Key": api_key},
        params={"page": 1, "page_size": 2},
    )
    body = resp.json()
    assert body["total"] == 5
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert len(body["items"]) == 2

    resp = await client.get(
        "/tasks",
        headers={"X-API-Key": api_key},
        params={"page": 3, "page_size": 2},
    )
    assert len(resp.json()["items"]) == 1


async def test_list_page_size_capped_at_200(client, api_key):
    """§5.3: page_size 上限 200, 超出应被拒 (422 校验错误)."""
    resp = await client.get(
        "/tasks", headers={"X-API-Key": api_key}, params={"page_size": 500}
    )
    assert resp.status_code == 422


async def test_list_sorted_by_created_desc(client, api_key):
    """§3.2: 列表按日期排序 (最新在前).

    Sleep between submissions so created_at timestamps are strictly distinct
    (the id-based tiebreaker is UUID, not time-ordered), making the exact
    reverse-submission order deterministic.
    """
    import asyncio

    ids = []
    for _ in range(3):
        ids.append(await _submit(client, api_key))
        await asyncio.sleep(0.01)
    resp = await client.get("/tasks", headers={"X-API-Key": api_key})
    returned = [it["task_id"] for it in resp.json()["items"]]
    assert returned == list(reversed(ids))


async def test_list_requires_auth(client):
    """§3.2: 列表需要 X-API-Key (401)."""
    resp = await client.get("/tasks")
    assert resp.status_code == 401


# ===== GET /tasks/{id}/result — stream from upstream (§5.1) =====


async def test_get_result_streams_from_upstream(client, api_key):
    """§5.1: 结果从上游按 upstream_task_id 流式透传."""
    task_id = await _submit(client, api_key)
    resp = await client.get(f"/tasks/{task_id}/result", headers={"X-API-Key": api_key})
    assert resp.status_code == 200
    assert "result content" in resp.text


async def test_get_result_enforces_ownership(client, admin_headers, api_key):
    """§3.3: 非拥有者不得获取结果 (404)."""
    task_id = await _submit(client, api_key)
    other = (
        await client.post("/auth/keys", json={"label": "o3"}, headers=admin_headers)
    ).json()["api_key"]
    resp = await client.get(f"/tasks/{task_id}/result", headers={"X-API-Key": other})
    assert resp.status_code == 404


async def test_get_result_409_when_no_upstream_task_id(client, api_key):
    """§5.1: 任务尚无 upstream_task_id (提交未成功映射) 时无法取结果 → 409."""
    from sqlalchemy import select

    from mineru_gateway.models import ApiKey
    from mineru_gateway.tasks import service

    db = client._transport.app.state.db
    async with db.session_factory() as session:
        key = (await session.execute(select(ApiKey))).scalars().first()
        task = await service.create(
            session,
            api_key_id=key.id,
            status="pending",
            upstream_url="http://mock-upstream",
            upstream_task_id=None,
            file_names=["x.pdf"],
            file_count=1,
        )
        task_id = task.id

    resp = await client.get(f"/tasks/{task_id}/result", headers={"X-API-Key": api_key})
    assert resp.status_code == 409


# ===== DELETE /tasks/{id} — cancel (§3.2, §5.3) =====


async def test_cancel_pending_task(client, api_key):
    """§5.3: 取消 pending 任务 → status=cancelled; 上游可连通则转发取消."""
    task_id = await _submit(client, api_key)
    resp = await client.delete(f"/tasks/{task_id}", headers={"X-API-Key": api_key})
    assert resp.status_code == 200
    body = resp.json()
    assert body["task_id"] == task_id
    assert body["status"] == "cancelled"
    assert body["message"]

    # State persisted.
    detail = await client.get(f"/tasks/{task_id}", headers={"X-API-Key": api_key})
    assert detail.json()["status"] == "cancelled"


async def test_cancel_only_allowed_for_pending(client, api_key):
    """§5.3: 仅 pending 可取消; 已终态任务取消应被拒 (409)."""
    task_id = await _submit(client, api_key)
    # First cancel succeeds.
    await client.delete(f"/tasks/{task_id}", headers={"X-API-Key": api_key})
    # Second cancel (now cancelled, not pending) is rejected.
    resp = await client.delete(f"/tasks/{task_id}", headers={"X-API-Key": api_key})
    assert resp.status_code == 409


async def test_cancel_enforces_ownership(client, admin_headers, api_key):
    """§3.3: 非拥有者不能取消他人任务 (404)."""
    task_id = await _submit(client, api_key)
    other = (
        await client.post("/auth/keys", json={"label": "o4"}, headers=admin_headers)
    ).json()["api_key"]
    resp = await client.delete(f"/tasks/{task_id}", headers={"X-API-Key": other})
    assert resp.status_code == 404


async def test_cancel_succeeds_when_upstream_unreachable(client, api_key):
    """§5.3: 上游不可连通时仍在本地标记 cancelled (best-effort 转发).

    cancel_raises makes the mock's DELETE /tasks/{id} raise, exercising the
    best-effort `except Exception: pass` branch in the route.
    """
    task_id = await _submit(client, api_key)
    mock_state.cancel_raises = True
    resp = await client.delete(f"/tasks/{task_id}", headers={"X-API-Key": api_key})
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"

    # State persisted despite upstream forward failing.
    detail = await client.get(f"/tasks/{task_id}", headers={"X-API-Key": api_key})
    assert detail.json()["status"] == "cancelled"


async def test_cancel_requires_auth(client, api_key):
    """§3.2: 取消需要 X-API-Key (401)."""
    task_id = await _submit(client, api_key)
    resp = await client.delete(f"/tasks/{task_id}")
    assert resp.status_code == 401
