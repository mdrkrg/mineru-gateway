"""Tests for Phase 2 task management: list, detail, result, cancel.

Spec: mvp-implementation.md §3.2, §5.1, §5.3, §3.3, §4.
Also covers batch-endpoints.md: POST /tasks/result-zip and POST /tasks/cancel.
"""

from __future__ import annotations

import io
import json
import uuid
import zipfile
from datetime import date, datetime, timedelta, timezone

from tests.mock_upstream import state as mock_state


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
    """§3.2: 格式错误的 UUID 返回 422."""
    resp = await client.get("/tasks/does-not-exist", headers={"X-API-Key": api_key})
    assert resp.status_code == 422


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
    """§5.1: 结果从上游按 upstream_task_id 流式透传 (需任务已达终态)."""
    task_id = await _submit(client, api_key)
    db = client._transport.app.state.db
    async with db.session_factory() as session:
        from mineru_gateway import models

        task = await session.get(models.TaskRecord, uuid.UUID(task_id))
        task.status = "completed"
        await session.commit()
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
    from sqlalchemy import select

    from mineru_gateway.models import ApiKey

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


async def test_cancel_releases_cache(client, api_key, app):
    """§3.4: 取消 (终态) 后删除该任务的暂存文件并清空 cache_dir."""
    import os

    task_id = await _submit(client, api_key)

    from mineru_gateway.tasks import service

    async with app.state.db.session_factory() as session:
        task = await service.get(session, uuid.UUID(task_id))
        cache_dir = task.cache_dir
    assert cache_dir and os.path.isdir(cache_dir)

    resp = await client.delete(f"/tasks/{task_id}", headers={"X-API-Key": api_key})
    assert resp.status_code == 200

    assert not os.path.exists(cache_dir)
    async with app.state.db.session_factory() as session:
        task = await service.get(session, uuid.UUID(task_id))
        assert task.cache_dir is None


async def test_cancel_requires_auth(client, api_key):
    """§3.2: 取消需要 X-API-Key (401)."""
    task_id = await _submit(client, api_key)
    resp = await client.delete(f"/tasks/{task_id}")
    assert resp.status_code == 401


async def test_get_result_409_for_pending_task_with_upstream_id(
    client, api_key, sample_files
):
    """§3.7: 非终态任务 (has upstream_task_id but not terminal) → 409."""
    from tests.mock_upstream import state as ms

    ms.task_status = "pending"
    resp = await client.post(
        "/tasks", headers={"X-API-Key": api_key}, files=sample_files
    )
    assert resp.status_code == 202
    task_id = resp.json()["task_id"]

    result_resp = await client.get(
        f"/tasks/{task_id}/result", headers={"X-API-Key": api_key}
    )
    assert result_resp.status_code == 409


async def _submit_and_set_status(
    client, api_key, status: str
) -> tuple[str, str | None]:
    """Submit a task and set it to the given status. Returns (task_id, upstream_task_id)."""
    task_id = await _submit(client, api_key)
    db = client._transport.app.state.db
    from mineru_gateway import models

    async with db.session_factory() as session:
        task = await session.get(models.TaskRecord, uuid.UUID(task_id))
        task.status = status
        if status == "completed":
            task.completed_at = datetime.now(timezone.utc)
        await session.commit()
    async with db.session_factory() as session:
        task = await session.get(models.TaskRecord, uuid.UUID(task_id))
        return str(task_id), task.upstream_task_id


# ===== POST /tasks/result-zip (spec: batch-endpoints.md §1) =====


async def test_result_zip_all_completed_200(client, api_key):
    """§1.4 Z1: 3 completed tasks, all upstream return 200. Verify 200 + zip content."""
    ids = []
    for _ in range(3):
        tid, _ = await _submit_and_set_status(client, api_key, "completed")
        ids.append(tid)

    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": ids},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 200
    assert resp.headers.get("content-type") == "application/zip"
    assert "attachment" in resp.headers.get("content-disposition", "")
    assert "results.zip" in resp.headers.get("content-disposition", "")

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = zf.namelist()
        assert "_manifest.json" in names
        assert names[-1] == "_manifest.json"

        manifest = json.loads(zf.read("_manifest.json"))
        assert len(manifest["included"]) == 3
        assert len(manifest["skipped"]) == 0
        for item in manifest["included"]:
            assert "task_id" in item
            assert "entry" in item
            assert len(item["entry"]) > 0

        result_names = [n for n in names if n != "_manifest.json"]
        assert len(result_names) == 3
        for name in result_names:
            content = zf.read(name)
            assert len(content) > 0


async def test_result_zip_partial_non_completed(client, api_key):
    """§1.4 Z2: tasks in completed, processing, pending -> 409 with non_downloadable."""
    tid_c, _ = await _submit_and_set_status(client, api_key, "completed")
    tid_p, _ = await _submit_and_set_status(client, api_key, "processing")
    tid_pe, _ = await _submit_and_set_status(client, api_key, "pending")

    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": [tid_c, tid_p, tid_pe]},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 409
    body = resp.json()
    assert "non_downloadable" in body
    assert len(body["non_downloadable"]) == 2
    reasons = {item["task_id"]: item["reason"] for item in body["non_downloadable"]}
    assert reasons[tid_p] == "not_completed"
    assert reasons[tid_pe] == "not_completed"
    assert tid_c not in reasons


async def test_result_zip_all_non_downloadable(client, api_key):
    """§1.4 Z3: all 3 tasks pending -> 409 with 3 non_downloadable items."""
    ids = []
    for _ in range(3):
        tid, _ = await _submit_and_set_status(client, api_key, "pending")
        ids.append(tid)

    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": ids},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 409
    body = resp.json()
    assert len(body["non_downloadable"]) == 3
    for item in body["non_downloadable"]:
        assert item["reason"] == "not_completed"


async def test_result_zip_not_owned(client, admin_headers, api_key):
    """§1.4 Z4: task owned by Key-A, requested by Key-B -> 404."""
    tid, _ = await _submit_and_set_status(client, api_key, "completed")
    other_key = (
        await client.post("/auth/keys", json={"label": "other"}, headers=admin_headers)
    ).json()["api_key"]

    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": [tid]},
        headers={"X-API-Key": other_key},
    )
    assert resp.status_code == 404
    assert "Task not found" in resp.json()["detail"]


async def test_result_zip_too_many_ids(client, api_key):
    """§1.4 Z5: 201 task_ids -> 422."""
    fake_ids = [str(uuid.uuid4()) for _ in range(201)]
    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": fake_ids},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 422


async def test_result_zip_upstream_partial_failure(client, api_key):
    """§1.4 Z6: 2 completed tasks, task-2 upstream 500 -> 200, manifest shows 1 included + 1 skipped."""
    tid1, utid1 = await _submit_and_set_status(client, api_key, "completed")
    tid2, utid2 = await _submit_and_set_status(client, api_key, "completed")

    mock_state.task_result_overrides[utid2] = {
        "status_code": 500,
        "content": b"Internal Server Error",
    }

    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": [tid1, tid2]},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 200

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        assert "_manifest.json" in zf.namelist()
        manifest = json.loads(zf.read("_manifest.json"))
        assert len(manifest["included"]) == 1
        assert manifest["included"][0]["task_id"] == tid1
        assert len(manifest["skipped"]) == 1
        assert manifest["skipped"][0]["task_id"] == tid2
        assert manifest["skipped"][0]["reason"] == "upstream_error"
        assert "detail" in manifest["skipped"][0]
        assert "500" in manifest["skipped"][0]["detail"]


async def test_result_zip_entry_naming_with_filename(client, api_key):
    """§1.4 Z7: file_names=['thesis.pdf'], no Content-Disposition -> entry named thesis/result.zip."""
    from mineru_gateway import models

    tid, utid = await _submit_and_set_status(client, api_key, "completed")
    db = client._transport.app.state.db
    async with db.session_factory() as session:
        task = await session.get(models.TaskRecord, uuid.UUID(tid))
        task.file_names = ["thesis.pdf"]
        await session.commit()

    mock_state.result_content_type = "application/zip"

    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": [tid]},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 200

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = zf.namelist()
        assert "_manifest.json" in names
        assert "thesis/result.zip" in names
        manifest = json.loads(zf.read("_manifest.json"))
        assert manifest["included"][0]["entry"] == "thesis/result.zip"


async def test_result_zip_entry_naming_fallback_to_task_id(client, api_key):
    """§1.4 Z8: file_names=[], no Content-Disposition -> entry named <task_id>/result.zip."""
    tid, utid = await _submit_and_set_status(client, api_key, "completed")
    db = client._transport.app.state.db
    async with db.session_factory() as session:
        from mineru_gateway import models

        task = await session.get(models.TaskRecord, uuid.UUID(tid))
        task.file_names = []
        await session.commit()

    mock_state.result_content_type = "application/zip"

    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": [tid]},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 200

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = zf.namelist()
        assert "_manifest.json" in names
        assert f"{tid}/result.zip" in names
        manifest = json.loads(zf.read("_manifest.json"))
        assert manifest["included"][0]["entry"] == f"{tid}/result.zip"


async def test_result_zip_all_upstream_fail(client, api_key):
    """§1.4 Z9: 2 completed tasks, both upstream 500 -> 200, zip only _manifest.json, 2 skipped."""
    tid1, utid1 = await _submit_and_set_status(client, api_key, "completed")
    tid2, utid2 = await _submit_and_set_status(client, api_key, "completed")

    mock_state.task_result_overrides[utid1] = {
        "status_code": 500,
        "content": b"upstream error",
    }
    mock_state.task_result_overrides[utid2] = {
        "status_code": 500,
        "content": b"upstream error",
    }

    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": [tid1, tid2]},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 200

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = zf.namelist()
        assert names == ["_manifest.json"]
        manifest = json.loads(zf.read("_manifest.json"))
        assert len(manifest["included"]) == 0
        assert len(manifest["skipped"]) == 2
        for skipped in manifest["skipped"]:
            assert skipped["reason"] == "upstream_error"
            assert "detail" in skipped
            assert "500" in skipped["detail"]


async def test_result_zip_manifest_is_last_entry(client, api_key):
    """§1.4 Z10: 3 completed tasks all upstream 200 -> _manifest.json is last zip entry."""
    ids = []
    for _ in range(3):
        tid, _ = await _submit_and_set_status(client, api_key, "completed")
        ids.append(tid)

    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": ids},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 200

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = zf.namelist()
        assert names[-1] == "_manifest.json"
        assert "_manifest.json" in names
        manifest = json.loads(zf.read("_manifest.json"))
        assert len(manifest["included"]) == 3
        assert len(manifest["skipped"]) == 0
        for item in manifest["included"]:
            assert "entry" in item
            assert len(item["entry"]) > 0


# ===== POST /tasks/cancel (spec: batch-endpoints.md §2) =====


async def test_batch_cancel_all_pending(client, api_key):
    """§2.5 C1: 2 pending tasks all cancelled -> cancelled_count=2, errors=[], status=cancelled."""
    ids = []
    for _ in range(2):
        tid, _ = await _submit_and_set_status(client, api_key, "pending")
        ids.append(tid)

    resp = await client.post(
        "/tasks/cancel",
        json={"task_ids": ids},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["cancelled_count"] == 2
    assert len(body["cancelled_ids"]) == 2
    assert body["errors"] == []

    for tid in ids:
        detail = await client.get(f"/tasks/{tid}", headers={"X-API-Key": api_key})
        assert detail.json()["status"] == "cancelled"


async def test_batch_cancel_mixed_statuses(client, api_key):
    """§2.5 C2: 1 pending, 1 processing, 1 completed -> cancelled_count=1, 2 errors."""
    tid_pe, _ = await _submit_and_set_status(client, api_key, "pending")
    tid_pr, _ = await _submit_and_set_status(client, api_key, "processing")
    tid_co, _ = await _submit_and_set_status(client, api_key, "completed")

    resp = await client.post(
        "/tasks/cancel",
        json={"task_ids": [tid_pe, tid_pr, tid_co]},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["cancelled_count"] == 1
    assert body["cancelled_ids"] == [tid_pe]
    assert len(body["errors"]) == 2

    error_map = {e["task_id"]: e for e in body["errors"]}
    assert error_map[tid_pr]["reason"] == "not_cancellable"
    assert error_map[tid_pr]["current_status"] == "processing"
    assert error_map[tid_co]["reason"] == "not_cancellable"
    assert error_map[tid_co]["current_status"] == "completed"


async def test_batch_cancel_not_found_and_not_owned(client, admin_headers, api_key):
    """§2.5 C3: 1 non-existent, 1 owned by other key -> cancelled_count=0, 2 not_found."""
    other_key = (
        await client.post("/auth/keys", json={"label": "o2"}, headers=admin_headers)
    ).json()["api_key"]
    tid_other, _ = await _submit_and_set_status(client, other_key, "pending")

    fake_id = str(uuid.uuid4())

    resp = await client.post(
        "/tasks/cancel",
        json={"task_ids": [fake_id, tid_other]},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["cancelled_count"] == 0
    assert body["cancelled_ids"] == []
    assert len(body["errors"]) == 2
    for err in body["errors"]:
        assert err["reason"] == "not_found"


async def test_batch_cancel_upstream_unreachable(client, api_key):
    """§2.5 C4: all pending, upstream unreachable -> still cancelled locally, count=2."""
    ids = []
    for _ in range(2):
        tid, _ = await _submit_and_set_status(client, api_key, "pending")
        ids.append(tid)

    mock_state.cancel_raises = True

    resp = await client.post(
        "/tasks/cancel",
        json={"task_ids": ids},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["cancelled_count"] == 2
    assert body["errors"] == []

    for tid in ids:
        detail = await client.get(f"/tasks/{tid}", headers={"X-API-Key": api_key})
        assert detail.json()["status"] == "cancelled"


async def test_batch_cancel_empty_ids(client, api_key):
    """§2.5 C5: empty task_ids -> 422."""
    resp = await client.post(
        "/tasks/cancel",
        json={"task_ids": []},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 422


# ===== Additional tests from spec review (batch-endpoints.md) =====


async def test_result_zip_empty_ids(client, api_key):
    """§1.2 step 2 review: empty task_ids -> 422."""
    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": []},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 422


async def test_result_zip_requires_auth(client):
    """§1.2 step 1 review: no API key -> 401."""
    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": [str(uuid.uuid4())]},
    )
    assert resp.status_code == 401


async def test_result_zip_missing_upstream_task_id(client, api_key):
    """§1.2 step 4 review: completed task without upstream_task_id -> 409 with missing_upstream_task_id."""
    from sqlalchemy import select

    from mineru_gateway.models import ApiKey
    from mineru_gateway.tasks import service

    db = client._transport.app.state.db
    async with db.session_factory() as session:
        key = (await session.execute(select(ApiKey))).scalars().first()
        task = await service.create(
            session,
            api_key_id=key.id,
            status="completed",
            upstream_url="http://mock-upstream",
            upstream_task_id=None,
            file_names=["test.pdf"],
            file_count=1,
        )
        task.completed_at = datetime.now(timezone.utc)
        await session.commit()
        tid = str(task.id)

    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": [tid]},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 409
    body = resp.json()
    assert len(body["non_downloadable"]) == 1
    assert body["non_downloadable"][0]["reason"] == "missing_upstream_task_id"


async def test_result_zip_entry_naming_from_content_disposition(client, api_key):
    """§1.2 step 6a review: upstream Content-Disposition filename is used for entry name."""
    from mineru_gateway import models

    tid, _ = await _submit_and_set_status(client, api_key, "completed")
    db = client._transport.app.state.db
    async with db.session_factory() as session:
        task = await session.get(models.TaskRecord, uuid.UUID(tid))
        task.file_names = ["ignored.pdf"]
        await session.commit()

    mock_state.result_content_disposition = 'attachment; filename="upstream-name.zip"'

    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": [tid]},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 200

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = zf.namelist()
        assert "upstream-name.zip" in names
        manifest = json.loads(zf.read("_manifest.json"))
        assert manifest["included"][0]["entry"] == "upstream-name.zip"


async def test_result_zip_ownership_checked_before_downloadability(
    client, admin_headers, api_key
):
    """§1.2 steps 3-4 review: ownership check (404) takes priority over downloadability (409)."""
    tid_owned, _ = await _submit_and_set_status(client, api_key, "processing")
    other_key = (
        await client.post("/auth/keys", json={"label": "other"}, headers=admin_headers)
    ).json()["api_key"]

    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": [tid_owned]},
        headers={"X-API-Key": other_key},
    )
    assert resp.status_code == 404
    assert "non_downloadable" not in resp.json()


async def test_result_zip_bin_extension_fallback(client, api_key):
    """§1.2 step 6d review: unknown Content-Type -> extension defaults to .bin."""
    tid, _ = await _submit_and_set_status(client, api_key, "completed")

    mock_state.result_content_type = "application/x-unknown-custom"

    resp = await client.post(
        "/tasks/result-zip",
        json={"task_ids": [tid]},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 200

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = zf.namelist()
        result_names = [n for n in names if n != "_manifest.json"]
        assert len(result_names) == 1
        assert result_names[0].endswith("result.bin")


async def test_batch_cancel_too_many_ids(client, api_key):
    """§2.2 step 2 review: >200 task_ids -> 422."""
    fake_ids = [str(uuid.uuid4()) for _ in range(201)]
    resp = await client.post(
        "/tasks/cancel",
        json={"task_ids": fake_ids},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 422


async def test_batch_cancel_requires_auth(client):
    """§2.2 step 1 review: no API key -> 401."""
    resp = await client.post(
        "/tasks/cancel",
        json={"task_ids": [str(uuid.uuid4())]},
    )
    assert resp.status_code == 401


async def test_batch_cancel_retry_pending_not_cancellable(client, api_key):
    """§2.4 review: retry_pending tasks are not cancellable."""
    tid, _ = await _submit_and_set_status(client, api_key, "retry_pending")

    resp = await client.post(
        "/tasks/cancel",
        json={"task_ids": [tid]},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["cancelled_count"] == 0
    assert len(body["errors"]) == 1
    assert body["errors"][0]["task_id"] == tid
    assert body["errors"][0]["reason"] == "not_cancellable"
    assert body["errors"][0]["current_status"] == "retry_pending"


async def test_batch_cancel_releases_cache(client, api_key, app):
    """§2.2 step 3d review: cancelled tasks have their cache_dir released."""
    import os

    ids = []
    for _ in range(2):
        tid, _ = await _submit_and_set_status(client, api_key, "pending")
        ids.append(tid)

    from mineru_gateway.tasks import service

    cache_dirs = []
    async with app.state.db.session_factory() as session:
        for tid in ids:
            task = await service.get(session, uuid.UUID(tid))
            cache_dirs.append(task.cache_dir)

    resp = await client.post(
        "/tasks/cancel",
        json={"task_ids": ids},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 200

    for cd in cache_dirs:
        assert not os.path.exists(cd)
    async with app.state.db.session_factory() as session:
        for tid in ids:
            task = await service.get(session, uuid.UUID(tid))
            assert task.cache_dir is None


async def test_cancel_single_retry_pending_409(client, api_key):
    """§2.4: single DELETE /tasks/{id} rejects retry_pending with 409."""
    tid, _ = await _submit_and_set_status(client, api_key, "retry_pending")

    resp = await client.delete(f"/tasks/{tid}", headers={"X-API-Key": api_key})
    assert resp.status_code == 409
