"""Tests for authenticated + anonymous proxying of POST /tasks and /file_parse.

Spec: mvp-implementation.md §3.3 (透明代理 / 认证策略), §5.1-5.2 (已有端点 +
响应头), §6.2 (透传核心 handle_task_submission), §3.5 (并发控制与保护).
Plan: Phase 1 — "POST /tasks (异步) + POST /file_parse (同步) 流式透传"; 提前落地
的持久化 (Phase 2) 与保护 (Phase 4) 一并覆盖。
"""

from __future__ import annotations

import asyncio
import uuid

from unittest.mock import AsyncMock, patch

from mineru_gateway.config import Settings
from mineru_gateway.main import create_app
from asgi_lifespan import LifespanManager
import httpx

from tests.mock_upstream import create_mock_upstream, state as mock_state


async def test_submit_requires_key_when_anonymous_disabled(client, sample_files):
    """§3.3: 默认禁止匿名 (ALLOW_ANONYMOUS=false) → 无 Key 提交被拒 (401)."""
    resp = await client.post("/tasks", files=sample_files)
    assert resp.status_code == 401


async def test_submit_authenticated_creates_task_and_superset_response(
    client, api_key, sample_files
):
    """§6.2 / §5.2: 认证提交返回 Gateway task_id 的兼容超集响应 + X-MinerU-* 头."""
    resp = await client.post(
        "/tasks", headers={"X-API-Key": api_key}, files=sample_files
    )
    assert resp.status_code == 202
    body = resp.json()
    # Gateway id replaces upstream id, superset fields added.
    assert body["task_id"]
    assert body["status"] == "pending"
    assert body["status_url"].endswith(f"/tasks/{body['task_id']}")
    assert body["result_url"].endswith(f"/tasks/{body['task_id']}/result")
    assert body["file_names"] == ["doc.pdf"]
    # §3.7: 202 应含 started_at / completed_at / error（均 null），与上游兼容
    assert body.get("started_at") is None
    assert body.get("completed_at") is None
    assert body.get("error") is None
    # Compatibility response headers present.
    assert resp.headers["X-MinerU-Task-Id"] == body["task_id"]


async def test_submit_records_parse_parameters(client, api_key, sample_files):
    """§4 (TaskRecord 解析参数) / §6.2 步骤6: 表单解析参数落库并类型正确."""
    resp = await client.post(
        "/tasks",
        headers={"X-API-Key": api_key},
        files=sample_files,
        data={
            "backend": "pipeline",
            "formula_enable": "true",
            "table_enable": "0",
            "start_page_id": "2",
            "lang_list": "en,ch",
        },
    )
    assert resp.status_code == 202
    task_id = resp.json()["task_id"]

    from mineru_gateway.models import TaskRecord

    async with client._transport.app.state.db.session_factory() as session:
        task = await session.get(TaskRecord, uuid.UUID(task_id))
        assert task.backend == "pipeline"
        assert task.parse_params["formula_enable"] is True
        assert task.parse_params["table_enable"] is False
        assert task.parse_params["start_page_id"] == 2
        assert task.parse_params["lang_list"] == ["en", "ch"]


async def test_submit_rejects_when_total_exceeds_max_size(
    client, admin_headers, sample_files
):
    """§3.5: 文件大小限制按请求累计生效 — 多个小文件合计超限也应 413."""
    # Issue a key on an app whose settings we can inspect; use the shared app but
    # drive many files so the cumulative size trips the per-request limit.
    raw = (
        await client.post("/auth/keys", json={"label": "sz"}, headers=admin_headers)
    ).json()["api_key"]
    max_size = client._transport.app.state.settings.max_upload_size
    half = b"x" * (max_size // 2 + 1)
    files = [
        ("files", ("a.pdf", half, "application/pdf")),
        ("files", ("b.pdf", half, "application/pdf")),
    ]
    resp = await client.post("/tasks", headers={"X-API-Key": raw}, files=files)
    assert resp.status_code == 413


async def test_submit_upstream_non_202_surfaces_error(client, api_key, sample_files):
    """§6.2 步骤5: 上游非 202 提交失败时向客户端透出上游状态码."""
    mock_state.submit_status = 500
    resp = await client.post(
        "/tasks", headers={"X-API-Key": api_key}, files=sample_files
    )
    assert resp.status_code == 500


async def test_submit_503_when_no_free_slots(client, api_key, sample_files):
    """§3.5 / §6.2 步骤2: 健康感知门控, free_slots<=0 → 503 + Retry-After."""
    mock_state.processing = mock_state.max_concurrent
    resp = await client.post(
        "/tasks", headers={"X-API-Key": api_key}, files=sample_files
    )
    assert resp.status_code == 503
    assert resp.headers.get("Retry-After") == "5"


async def test_file_parse_authenticated_relays_result(client, api_key, sample_files):
    """§3.3 / §5.1 POST /file_parse: 同步端点直接透传上游解析结果 (200)."""
    resp = await client.post(
        "/file_parse", headers={"X-API-Key": api_key}, files=sample_files
    )
    assert resp.status_code == 200
    assert resp.json()["markdown"] == "# parsed"


async def test_file_parse_authenticated_records_task(
    client, api_key, sample_files, app
):
    """§3.3: 认证 /file_parse 记录一条 completed 任务 (供历史/所有权)."""
    from sqlalchemy import func, select

    from mineru_gateway.models import TaskRecord

    resp = await client.post(
        "/file_parse", headers={"X-API-Key": api_key}, files=sample_files
    )
    assert resp.status_code == 200

    async with app.state.db.session_factory() as session:
        count = await session.scalar(select(func.count()).select_from(TaskRecord))
        assert count == 1
        task = (await session.execute(select(TaskRecord))).scalar_one()
        assert task.status == "completed"
        assert task.file_names == ["doc.pdf"]


async def test_file_parse_requires_key_when_anonymous_disabled(client, sample_files):
    """§3.3: /file_parse 同样默认禁止匿名 → 无 Key 401."""
    resp = await client.post("/file_parse", files=sample_files)
    assert resp.status_code == 401


async def test_file_parse_503_when_no_free_slots(client, api_key, sample_files):
    """§3.5: /file_parse 也受健康门控约束 — 无空闲 slot → 503 + Retry-After."""
    mock_state.processing = mock_state.max_concurrent
    resp = await client.post(
        "/file_parse", headers={"X-API-Key": api_key}, files=sample_files
    )
    assert resp.status_code == 503
    assert resp.headers.get("Retry-After") == "5"


async def test_file_parse_rejects_when_total_exceeds_max_size(client, api_key):
    """§3.5: /file_parse 同样执行文件大小限制 → 超限 413."""
    max_size = client._transport.app.state.settings.max_upload_size
    files = [("files", ("big.pdf", b"x" * (max_size + 1), "application/pdf"))]
    resp = await client.post("/file_parse", headers={"X-API-Key": api_key}, files=files)
    assert resp.status_code == 413


async def test_file_parse_429_when_rate_limited(client, admin_headers, sample_files):
    """§3.5: /file_parse 也走按 Key 内存限流 — 耗尽突发预算后 429 + Retry-After."""
    raw = (
        await client.post("/auth/keys", json={"label": "fp-rl"}, headers=admin_headers)
    ).json()["api_key"]
    hit_429 = False
    for _ in range(40):
        resp = await client.post(
            "/file_parse", headers={"X-API-Key": raw}, files=sample_files
        )
        if resp.status_code == 429:
            hit_429 = True
            assert resp.headers.get("Retry-After") == "60"
            break
    assert hit_429


# --- Anonymous mode (ALLOW_ANONYMOUS=true): pure passthrough, no task record ---


async def _anon_client(tmp_path):
    settings = Settings(
        upstream_url="http://mock-upstream",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'anon.db'}",
        admin_token="test-admin-token",
        allow_anonymous=True,
        gateway_url="http://testserver",
        file_cache_dir=str(tmp_path / "cache"),
        enable_background=False,
        json_logs=False,
        create_tables=True,
    )
    upstream = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_mock_upstream()),
        base_url="http://mock-upstream",
    )
    app = create_app(settings=settings, upstream_client=upstream)
    return app, settings


async def test_anonymous_passthrough_no_record(tmp_path):
    """§3.3 / §4 (约束): ALLOW_ANONYMOUS=true 时无 Key 为纯透传, 不写 tasks 表.

    验证 api_key_id NOT NULL 的前提 — 匿名请求不入库, 保留上游 task_id 原样透传.
    """
    app, settings = await _anon_client(tmp_path)
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            files = [("files", ("a.pdf", b"data", "application/pdf"))]
            resp = await c.post("/tasks", files=files)
            # Pure passthrough: upstream 202 body relayed (upstream task_id kept).
            assert resp.status_code == 202
            assert resp.json()["task_id"].startswith("up-")

        # No task rows written for anonymous requests.
        from sqlalchemy import func, select
        from mineru_gateway.models import TaskRecord

        async with app.state.db.session_factory() as session:
            count = await session.scalar(select(func.count()).select_from(TaskRecord))
            assert count == 0


async def test_anonymous_file_parse_passthrough_no_record(tmp_path):
    """§3.3: ALLOW_ANONYMOUS=true 时无 Key 的 /file_parse 也为纯透传, 不入库."""
    app, settings = await _anon_client(tmp_path)
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            files = [("files", ("a.pdf", b"data", "application/pdf"))]
            resp = await c.post("/file_parse", files=files)
            assert resp.status_code == 200
            assert resp.json()["markdown"] == "# parsed"

        from sqlalchemy import func, select

        from mineru_gateway.models import TaskRecord

        async with app.state.db.session_factory() as session:
            count = await session.scalar(select(func.count()).select_from(TaskRecord))
            assert count == 0


async def test_queued_ahead_captured_and_relayed(client, api_key, sample_files):
    """§3.7: 上游 queued_ahead 被捕获, 在 detail 和 list 中都返回."""
    from tests.mock_upstream import state as mock_state

    mock_state.queued_ahead = 5
    resp = await client.post(
        "/tasks", headers={"X-API-Key": api_key}, files=sample_files
    )
    assert resp.status_code == 202
    task_id = resp.json()["task_id"]

    detail = await client.get(f"/tasks/{task_id}", headers={"X-API-Key": api_key})
    assert detail.status_code == 200
    assert detail.json()["queued_ahead"] == 5

    list_resp = await client.get(
        "/tasks", headers={"X-API-Key": api_key}, params={"status": "pending"}
    )
    assert list_resp.json()["items"][0]["queued_ahead"] == 5


# --- Idempotent submission (spec: idempotent-submission.md) ---


async def test_idempotent_first_submission_with_key(client, api_key, sample_files):
    """T1 sec 6.1: first submission with X-Idempotency-Key stores key in DB,
    returns 202 with no X-Idempotency-Key-Replayed response header."""
    resp = await client.post(
        "/tasks",
        headers={"X-API-Key": api_key, "X-Idempotency-Key": "key-1"},
        files=sample_files,
    )
    assert resp.status_code == 202
    assert "X-Idempotency-Key-Replayed" not in resp.headers

    task_id = resp.json()["task_id"]
    from mineru_gateway.models import TaskRecord

    async with client._transport.app.state.db.session_factory() as session:
        task = await session.get(TaskRecord, uuid.UUID(task_id))
        assert task.idempotency_key == "key-1"


async def test_idempotent_without_key_header(client, api_key, sample_files):
    """T4 sec 6.1: submission without X-Idempotency-Key stores NULL in DB,
    response does not include X-Idempotency-Key-Replayed."""
    resp = await client.post(
        "/tasks",
        headers={"X-API-Key": api_key},
        files=sample_files,
    )
    assert resp.status_code == 202
    assert "X-Idempotency-Key-Replayed" not in resp.headers

    task_id = resp.json()["task_id"]
    from mineru_gateway.models import TaskRecord

    async with client._transport.app.state.db.session_factory() as session:
        task = await session.get(TaskRecord, uuid.UUID(task_id))
        assert task.idempotency_key is None


async def test_idempotent_blank_key_treated_as_missing(client, api_key, sample_files):
    """T5 sec 6.1: empty string or whitespace-only X-Idempotency-Key
    treated as not provided, stores NULL in DB."""
    for idem_key in ("", "   ", "\t  "):
        resp = await client.post(
            "/tasks",
            headers={"X-API-Key": api_key, "X-Idempotency-Key": idem_key},
            files=sample_files,
        )
        assert resp.status_code == 202
        assert "X-Idempotency-Key-Replayed" not in resp.headers

        task_id = resp.json()["task_id"]
        from mineru_gateway.models import TaskRecord

        async with client._transport.app.state.db.session_factory() as session:
            task = await session.get(TaskRecord, uuid.UUID(task_id))
            assert task.idempotency_key is None


async def test_idempotent_repeat_same_key_returns_replay(client, api_key, sample_files):
    """T2 sec 6.1: second submission with same X-Idempotency-Key returns 202
    with X-Idempotency-Key-Replayed: true, same task_id, only one DB record."""
    idem_key = "t2-repeat-key"
    headers = {"X-API-Key": api_key, "X-Idempotency-Key": idem_key}

    resp1 = await client.post("/tasks", headers=headers, files=sample_files)
    assert resp1.status_code == 202
    assert "X-Idempotency-Key-Replayed" not in resp1.headers
    task_id_1 = resp1.json()["task_id"]

    resp2 = await client.post("/tasks", headers=headers, files=sample_files)
    assert resp2.status_code == 202
    assert resp2.headers.get("X-Idempotency-Key-Replayed") == "true"
    assert resp2.json()["task_id"] == task_id_1
    assert resp2.headers["X-MinerU-Task-Id"] == task_id_1
    assert resp2.headers["X-MinerU-Task-Status"] == "pending"
    assert resp2.headers["X-MinerU-Task-Status-Url"].endswith(f"/tasks/{task_id_1}")
    assert resp2.headers["X-MinerU-Task-Result-Url"].endswith(
        f"/tasks/{task_id_1}/result"
    )

    from sqlalchemy import func, select
    from mineru_gateway.models import TaskRecord

    async with client._transport.app.state.db.session_factory() as session:
        count = await session.scalar(select(func.count()).select_from(TaskRecord))
        assert count == 1


async def test_idempotent_repeat_after_task_completed(client, api_key, sample_files):
    """T3 sec 6.1: resubmit with same idempotency key after task completed.
    Should return original response (status: pending), not completed."""
    idem_key = "t3-completed-key"
    headers = {"X-API-Key": api_key, "X-Idempotency-Key": idem_key}

    resp1 = await client.post("/tasks", headers=headers, files=sample_files)
    assert resp1.status_code == 202
    task_id = resp1.json()["task_id"]

    from mineru_gateway.models import TaskRecord

    async with client._transport.app.state.db.session_factory() as session:
        task = await session.get(TaskRecord, uuid.UUID(task_id))
        task.status = "completed"
        await session.commit()

    resp2 = await client.post("/tasks", headers=headers, files=sample_files)
    assert resp2.status_code == 202
    assert resp2.headers.get("X-Idempotency-Key-Replayed") == "true"
    body = resp2.json()
    assert body["task_id"] == task_id
    assert body["status"] == "pending"
    assert body["started_at"] is None
    assert body["completed_at"] is None
    assert body["error"] is None
    assert isinstance(body["backend"], str)
    assert isinstance(body["file_names"], list)
    assert isinstance(body["created_at"], str)
    assert body["status_url"].endswith(f"/tasks/{task_id}")
    assert body["result_url"].endswith(f"/tasks/{task_id}/result")
    assert resp2.headers["X-MinerU-Task-Id"] == task_id
    assert resp2.headers["X-MinerU-Task-Status"] == "pending"
    assert resp2.headers["X-MinerU-Task-Status-Url"].endswith(f"/tasks/{task_id}")
    assert resp2.headers["X-MinerU-Task-Result-Url"].endswith(
        f"/tasks/{task_id}/result"
    )


async def test_idempotent_repeat_after_task_failed(client, api_key, sample_files):
    """T3b sec 6.1: resubmit with same key after task failed.
    Behavior matches T3: returns original pending response, not failed."""
    idem_key = "t3b-failed-key"
    headers = {"X-API-Key": api_key, "X-Idempotency-Key": idem_key}

    resp1 = await client.post("/tasks", headers=headers, files=sample_files)
    assert resp1.status_code == 202
    task_id = resp1.json()["task_id"]

    from mineru_gateway.models import TaskRecord

    async with client._transport.app.state.db.session_factory() as session:
        task = await session.get(TaskRecord, uuid.UUID(task_id))
        task.status = "failed"
        await session.commit()

    resp2 = await client.post("/tasks", headers=headers, files=sample_files)
    assert resp2.status_code == 202
    assert resp2.headers.get("X-Idempotency-Key-Replayed") == "true"
    body = resp2.json()
    assert body["task_id"] == task_id
    assert body["status"] == "pending"
    assert body["started_at"] is None
    assert body["completed_at"] is None
    assert body["error"] is None
    assert isinstance(body["backend"], str)
    assert isinstance(body["file_names"], list)
    assert isinstance(body["created_at"], str)
    assert body["status_url"].endswith(f"/tasks/{task_id}")
    assert body["result_url"].endswith(f"/tasks/{task_id}/result")
    assert resp2.headers["X-MinerU-Task-Id"] == task_id
    assert resp2.headers["X-MinerU-Task-Status"] == "pending"
    assert resp2.headers["X-MinerU-Task-Status-Url"].endswith(f"/tasks/{task_id}")
    assert resp2.headers["X-MinerU-Task-Result-Url"].endswith(
        f"/tasks/{task_id}/result"
    )


async def test_idempotent_different_keys_same_idempotency_key(
    client, admin_headers, sample_files
):
    """T6 sec 6.2: two different API Keys using the same idempotency key
    each create independent tasks. No conflict, no replay."""
    idem_key = "shared-key"
    resp_a = (
        await client.post("/auth/keys", json={"label": "key-A"}, headers=admin_headers)
    ).json()
    resp_b = (
        await client.post("/auth/keys", json={"label": "key-B"}, headers=admin_headers)
    ).json()
    key_a, key_b = resp_a["api_key"], resp_b["api_key"]

    r1 = await client.post(
        "/tasks",
        headers={"X-API-Key": key_a, "X-Idempotency-Key": idem_key},
        files=sample_files,
    )
    assert r1.status_code == 202
    assert "X-Idempotency-Key-Replayed" not in r1.headers

    r2 = await client.post(
        "/tasks",
        headers={"X-API-Key": key_b, "X-Idempotency-Key": idem_key},
        files=sample_files,
    )
    assert r2.status_code == 202
    assert "X-Idempotency-Key-Replayed" not in r2.headers
    assert r1.json()["task_id"] != r2.json()["task_id"]

    from sqlalchemy import func, select
    from mineru_gateway.models import TaskRecord

    async with client._transport.app.state.db.session_factory() as session:
        count = await session.scalar(select(func.count()).select_from(TaskRecord))
        assert count == 2


async def test_idempotent_same_key_different_idempotency_keys(
    client, api_key, sample_files
):
    """T7 sec 6.2: same API Key with different idempotency keys creates
    two independent tasks with different task_ids."""
    r1 = await client.post(
        "/tasks",
        headers={"X-API-Key": api_key, "X-Idempotency-Key": "key-1"},
        files=sample_files,
    )
    assert r1.status_code == 202
    assert "X-Idempotency-Key-Replayed" not in r1.headers

    r2 = await client.post(
        "/tasks",
        headers={"X-API-Key": api_key, "X-Idempotency-Key": "key-2"},
        files=sample_files,
    )
    assert r2.status_code == 202
    assert "X-Idempotency-Key-Replayed" not in r2.headers
    assert r1.json()["task_id"] != r2.json()["task_id"]

    from sqlalchemy import func, select
    from mineru_gateway.models import TaskRecord

    async with client._transport.app.state.db.session_factory() as session:
        count = await session.scalar(select(func.count()).select_from(TaskRecord))
        assert count == 2


async def test_idempotent_anonymous_ignores_key(tmp_path):
    """T8 sec 6.3: anonymous request with X-Idempotency-Key is ignored.
    Two anonymous submissions with same key each go through as pure
    passthrough, produce upstream task ids, and write no DB records."""
    app, settings = await _anon_client(tmp_path)
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            files = [("files", ("a.pdf", b"data", "application/pdf"))]
            headers = {"X-Idempotency-Key": "anon-key-1"}

            resp1 = await c.post("/tasks", headers=headers, files=files)
            assert resp1.status_code == 202
            assert resp1.json()["task_id"].startswith("up-")
            assert "X-Idempotency-Key-Replayed" not in resp1.headers

            resp2 = await c.post("/tasks", headers=headers, files=files)
            assert resp2.status_code == 202
            assert resp2.json()["task_id"].startswith("up-")
            assert "X-Idempotency-Key-Replayed" not in resp2.headers

        from sqlalchemy import func, select
        from mineru_gateway.models import TaskRecord

        async with app.state.db.session_factory() as session:
            count = await session.scalar(select(func.count()).select_from(TaskRecord))
            assert count == 0


async def test_idempotent_concurrent_same_key(client, api_key, sample_files):
    """T9 sec 6.4: two concurrent requests with same idempotency key.
    Only one task record created, both return 202, second gets replay.

    Mocks task_service.create to simulate a race condition: first call
    succeeds, second raises IntegrityError.  Also mocks get_by_idempotency_key
    to return None for the first two calls so both requests pass the
    idempotency check and reach create."""
    idem_key = "t9-race-key"
    headers = {"X-API-Key": api_key, "X-Idempotency-Key": idem_key}

    from sqlalchemy.exc import IntegrityError
    from mineru_gateway.tasks import service as task_service

    original_create = task_service.create
    _first_done = False

    async def racing_create(session, **fields):
        nonlocal _first_done
        if _first_done:
            raise IntegrityError(
                "mock",
                {},
                Exception("UNIQUE constraint failed: uq_tasks_key_idempotency"),
            )
        _first_done = True
        return await original_create(session, **fields)

    original_lookup = task_service.get_by_idempotency_key
    _lookup_count = 0

    async def racing_lookup(session, api_key_id, key):
        nonlocal _lookup_count
        _lookup_count += 1
        if _lookup_count <= 2:
            return None
        return await original_lookup(session, api_key_id, key)

    with patch.object(task_service, "create", side_effect=racing_create):
        with patch.object(
            task_service, "get_by_idempotency_key", side_effect=racing_lookup
        ):
            r1, r2 = await asyncio.gather(
                client.post("/tasks", headers=headers, files=sample_files),
                client.post("/tasks", headers=headers, files=sample_files),
                return_exceptions=True,
            )

    assert not isinstance(r1, Exception), f"r1 raised {r1}"
    assert not isinstance(r2, Exception), f"r2 raised {r2}"
    responses = [r1, r2]
    assert r1.status_code == 202
    assert r2.status_code == 202
    replayed = [
        r for r in responses if r.headers.get("X-Idempotency-Key-Replayed") == "true"
    ]
    assert len(replayed) == 1

    task_ids = [r.json()["task_id"] for r in responses]
    assert task_ids[0] == task_ids[1]

    from sqlalchemy import func, select
    from mineru_gateway.models import TaskRecord

    async with client._transport.app.state.db.session_factory() as session:
        count = await session.scalar(select(func.count()).select_from(TaskRecord))
        assert count == 1


async def test_idempotent_concurrent_failure_releases_cache(
    client, api_key, sample_files
):
    """T10 sec 6.4: the losing request in a race condition releases
    its file cache directory to avoid orphaned disk files."""
    idem_key = "t10-cache-key"
    headers = {"X-API-Key": api_key, "X-Idempotency-Key": idem_key}

    from sqlalchemy.exc import IntegrityError
    from mineru_gateway.tasks import service as task_service
    from mineru_gateway.tasks.cache import FileCache

    original_create = task_service.create
    lock = asyncio.Lock()
    first_committed = False

    async def racing_create(session, **fields):
        nonlocal first_committed
        async with lock:
            if first_committed:
                raise IntegrityError(
                    "mock",
                    {},
                    Exception("UNIQUE constraint failed: uq_tasks_key_idempotency"),
                )
            result = await original_create(session, **fields)
            first_committed = True
            return result

    original_lookup = task_service.get_by_idempotency_key
    _lookup_count = 0

    async def racing_lookup(session, api_key_id, key):
        nonlocal _lookup_count
        _lookup_count += 1
        if _lookup_count <= 2:
            return None
        return await original_lookup(session, api_key_id, key)

    with patch.object(task_service, "create", side_effect=racing_create):
        with patch.object(
            task_service, "get_by_idempotency_key", side_effect=racing_lookup
        ):
            with patch.object(
                FileCache, "release", new_callable=AsyncMock
            ) as mock_release:
                mock_release.return_value = None
                r1, r2 = await asyncio.gather(
                    client.post("/tasks", headers=headers, files=sample_files),
                    client.post("/tasks", headers=headers, files=sample_files),
                    return_exceptions=True,
                )

    assert not isinstance(r1, Exception), f"r1 raised {r1}"
    assert not isinstance(r2, Exception), f"r2 raised {r2}"
    assert mock_release.call_count == 1


async def test_idempotent_key_too_long_returns_422(client, api_key, sample_files):
    """T11 sec 6.5: X-Idempotency-Key longer than 255 chars returns
    422 Unprocessable Entity, no downstream processing."""
    long_key = "a" * 256
    resp = await client.post(
        "/tasks",
        headers={"X-API-Key": api_key, "X-Idempotency-Key": long_key},
        files=sample_files,
    )
    assert resp.status_code == 422


async def test_idempotent_replay_skips_rate_limit(tmp_path, sample_files):
    """T12 sec 6.5: idempotent replay does not consume rate limit tokens.
    First request exhausts burst=1 tokens. Second request with same
    key returns 202 via replay, not 429."""
    from mineru_gateway.config import Settings
    from mineru_gateway.main import create_app
    from mineru_gateway.limiter.memory import MemoryTokenBucket
    from asgi_lifespan import LifespanManager
    import httpx
    from tests.mock_upstream import create_mock_upstream

    settings = Settings(
        upstream_url="http://mock-upstream",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 't12.db'}",
        admin_token="test-admin-token",
        gateway_url="http://testserver",
        file_cache_dir=str(tmp_path / "cache"),
        enable_background=False,
        json_logs=False,
        create_tables=True,
        rate_limit_per_key=1,
    )
    upstream = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_mock_upstream()),
        base_url="http://mock-upstream",
    )
    app = create_app(settings=settings, upstream_client=upstream)

    async with LifespanManager(app):
        app.state.rate_limiter = MemoryTokenBucket(rate=1, burst=1)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            r = await c.post(
                "/auth/keys",
                json={"label": "rl"},
                headers={"X-Admin-Token": "test-admin-token"},
            )
            api_key = r.json()["api_key"]

            idem_key = "t12-rl-key"
            headers = {"X-API-Key": api_key, "X-Idempotency-Key": idem_key}
            files = [("files", ("a.pdf", b"data", "application/pdf"))]

            resp1 = await c.post("/tasks", headers=headers, files=files)
            assert resp1.status_code == 202

            resp2 = await c.post("/tasks", headers=headers, files=files)
            assert resp2.status_code == 202
            assert resp2.headers.get("X-Idempotency-Key-Replayed") == "true"

            # Control: a different key should be rate-limited (proves limiter is empty)
            resp3 = await c.post(
                "/tasks",
                headers={
                    "X-API-Key": api_key,
                    "X-Idempotency-Key": "different-key",
                },
                files=files,
            )
            assert resp3.status_code == 429


async def test_idempotent_key_at_max_length(client, api_key, sample_files):
    """GAP-1 sec 3.1: exactly 255-character X-Idempotency-Key is valid,
    returns 202 and stores the key."""
    key_255 = "a" * 255
    resp = await client.post(
        "/tasks",
        headers={"X-API-Key": api_key, "X-Idempotency-Key": key_255},
        files=sample_files,
    )
    assert resp.status_code == 202
    assert "X-Idempotency-Key-Replayed" not in resp.headers

    task_id = resp.json()["task_id"]
    from mineru_gateway.models import TaskRecord

    async with client._transport.app.state.db.session_factory() as session:
        task = await session.get(TaskRecord, uuid.UUID(task_id))
        assert task.idempotency_key == key_255


async def test_idempotent_blank_keys_do_not_collide(client, api_key, sample_files):
    """GAP-2 sec 2.2: same blank/whitespace idempotency key submitted twice
    creates two separate tasks (NULL values do not collide)."""
    headers = {"X-API-Key": api_key, "X-Idempotency-Key": "   "}

    resp1 = await client.post("/tasks", headers=headers, files=sample_files)
    assert resp1.status_code == 202
    task_id_1 = resp1.json()["task_id"]

    resp2 = await client.post("/tasks", headers=headers, files=sample_files)
    assert resp2.status_code == 202
    task_id_2 = resp2.json()["task_id"]
    assert task_id_1 != task_id_2

    from sqlalchemy import func, select
    from mineru_gateway.models import TaskRecord

    async with client._transport.app.state.db.session_factory() as session:
        count = await session.scalar(select(func.count()).select_from(TaskRecord))
        assert count == 2


async def test_idempotent_replay_skips_health_check(client, api_key, sample_files):
    """T12b sec 6.5: idempotent replay skips upstream health gating.
    When upstream is full (free_slots=0), replay still returns 202."""
    idem_key = "t12b-health-key"
    headers = {"X-API-Key": api_key, "X-Idempotency-Key": idem_key}

    resp1 = await client.post("/tasks", headers=headers, files=sample_files)
    assert resp1.status_code == 202

    mock_state.processing = mock_state.max_concurrent

    resp2 = await client.post("/tasks", headers=headers, files=sample_files)
    assert resp2.status_code == 202
    assert resp2.headers.get("X-Idempotency-Key-Replayed") == "true"

    # Control: a different key should be blocked by health gate (503)
    resp3 = await client.post(
        "/tasks",
        headers={
            "X-API-Key": api_key,
            "X-Idempotency-Key": "health-control-key",
        },
        files=sample_files,
    )
    assert resp3.status_code == 503


async def test_idempotent_key_reusable_after_cleanup(client, api_key, sample_files):
    """T13 sec 6.6: after TaskRecord is deleted, the idempotency key
    can be reused for a new submission (no replay)."""
    idem_key = "t13-cleanup-key"
    headers = {"X-API-Key": api_key, "X-Idempotency-Key": idem_key}

    resp1 = await client.post("/tasks", headers=headers, files=sample_files)
    assert resp1.status_code == 202
    task_id_1 = resp1.json()["task_id"]

    from mineru_gateway.models import TaskRecord

    async with client._transport.app.state.db.session_factory() as session:
        task = await session.get(TaskRecord, uuid.UUID(task_id_1))
        await session.delete(task)
        await session.commit()

    resp2 = await client.post("/tasks", headers=headers, files=sample_files)
    assert resp2.status_code == 202
    task_id_2 = resp2.json()["task_id"]
    assert "X-Idempotency-Key-Replayed" not in resp2.headers
    assert task_id_1 != task_id_2

    from sqlalchemy import func, select

    async with client._transport.app.state.db.session_factory() as session:
        count = await session.scalar(select(func.count()).select_from(TaskRecord))
        assert count == 1


async def test_file_parse_ignores_idempotency_key(client, api_key, sample_files):
    """GAP-3 sec 0 non-goal: POST /file_parse ignores X-Idempotency-Key.
    Two requests with the same key each return independent 200 responses,
    no X-Idempotency-Key-Replayed header."""
    headers = {"X-API-Key": api_key, "X-Idempotency-Key": "fp-key-1"}

    resp1 = await client.post("/file_parse", headers=headers, files=sample_files)
    assert resp1.status_code == 200
    assert "X-Idempotency-Key-Replayed" not in resp1.headers
    assert resp1.json()["markdown"] == "# parsed"

    resp2 = await client.post("/file_parse", headers=headers, files=sample_files)
    assert resp2.status_code == 200
    assert "X-Idempotency-Key-Replayed" not in resp2.headers
    assert resp2.json()["markdown"] == "# parsed"
