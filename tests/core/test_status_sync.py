"""Tests for Phase 3 background status synchronization.

Spec: mvp-implementation.md §3.4 (上游状态同步), §6.3 (status_sync_loop).
Plan: Phase 3 — "后台状态同步循环".

Each test drives the single-pass `sync_once` directly (the loop is just
`while True: sleep; sync_once`), so no timing/sleep is involved.
"""

from __future__ import annotations


from mineru_gateway.background import status_sync
from mineru_gateway.tasks import service
from mineru_gateway.tasks.cache import FileCache
from mineru_gateway.upstream.client import UpstreamClient

from tests.mock_upstream import state as mock_state


async def _make_task(session, api_key_id, **overrides):
    fields = dict(
        api_key_id=api_key_id,
        status="pending",
        upstream_url="http://mock-upstream",
        upstream_task_id="up-123",
        file_names=["a.pdf"],
        file_count=1,
    )
    fields.update(overrides)
    return await service.create(session, **fields)


async def _seed_key(session):
    from mineru_gateway.auth import service as auth_service

    record, _ = await auth_service.create_key(session, label="bg")
    return record.id


async def test_sync_updates_status_from_upstream(app, upstream_client):
    """§6.3: 非终态任务被拉取上游状态并写回 DB."""
    db = app.state.db
    upstream = UpstreamClient(upstream_client)
    async with db.session_factory() as session:
        key_id = await _seed_key(session)
        task = await _make_task(session, key_id)
        task_id = task.id

    mock_state.task_status = "completed"
    await status_sync.sync_once(db, upstream, poll_failure_threshold=3)

    async with db.session_factory() as session:
        refreshed = await service.get(session, task_id)
        assert refreshed.status == "completed"


async def test_sync_increments_poll_failures_on_error(app, upstream_client):
    """§6.3: 单任务状态查询失败 → 持久化递增 consecutive_poll_failures."""
    db = app.state.db
    upstream = UpstreamClient(upstream_client)
    async with db.session_factory() as session:
        key_id = await _seed_key(session)
        task = await _make_task(session, key_id)
        task_id = task.id

    mock_state.status_raises = True
    await status_sync.sync_once(db, upstream, poll_failure_threshold=3)

    async with db.session_factory() as session:
        refreshed = await service.get(session, task_id)
        assert refreshed.consecutive_poll_failures == 1


async def test_sync_marks_retryable_at_threshold(app, upstream_client):
    """§6.3: 连续失败达阈值 → 标记为可重试 (retry_pending)."""
    db = app.state.db
    upstream = UpstreamClient(upstream_client)
    async with db.session_factory() as session:
        key_id = await _seed_key(session)
        task = await _make_task(
            session, key_id, consecutive_poll_failures=2, cache_dir="/tmp/x"
        )
        task_id = task.id

    mock_state.status_raises = True
    await status_sync.sync_once(db, upstream, poll_failure_threshold=3)

    async with db.session_factory() as session:
        refreshed = await service.get(session, task_id)
        assert refreshed.status == "retry_pending"


async def test_sync_does_not_mark_retryable_without_cache_dir(app, upstream_client):
    """§3.4: 无暂存文件 (cache_dir=None) 的任务即使超阈值也不标记可重试.

    只有暂存文件仍在的任务才能重提；无 cache_dir 的任务保持原状态待下轮同步。
    """
    db = app.state.db
    upstream = UpstreamClient(upstream_client)
    async with db.session_factory() as session:
        key_id = await _seed_key(session)
        task = await _make_task(
            session, key_id, consecutive_poll_failures=2, cache_dir=None
        )
        task_id = task.id

    mock_state.status_raises = True
    await status_sync.sync_once(db, upstream, poll_failure_threshold=3)

    async with db.session_factory() as session:
        refreshed = await service.get(session, task_id)
        assert refreshed.status != "retry_pending"
        # Failure count still recorded for observability.
        assert refreshed.consecutive_poll_failures == 3


async def test_sync_marks_all_retryable_when_upstream_unreachable(app, upstream_client):
    """§6.3: 上游整体不可达时, 对所有非终态且有暂存文件的任务批量标记可重试."""
    db = app.state.db
    upstream = UpstreamClient(upstream_client)
    async with db.session_factory() as session:
        key_id = await _seed_key(session)
        t1 = await _make_task(session, key_id, cache_dir="/tmp/a")
        t2 = await _make_task(session, key_id, cache_dir="/tmp/b")
        ids = [t1.id, t2.id]

    mock_state.health_raises = True
    await status_sync.sync_once(db, upstream, poll_failure_threshold=3)

    async with db.session_factory() as session:
        for task_id in ids:
            refreshed = await service.get(session, task_id)
            assert refreshed.status == "retry_pending"


async def test_sync_ignores_terminal_tasks(app, upstream_client):
    """§6.3: 终态任务不参与状态同步."""
    db = app.state.db
    upstream = UpstreamClient(upstream_client)
    async with db.session_factory() as session:
        key_id = await _seed_key(session)
        task = await _make_task(session, key_id, status="completed")
        task_id = task.id

    mock_state.task_status = "processing"
    await status_sync.sync_once(db, upstream, poll_failure_threshold=3)

    async with db.session_factory() as session:
        refreshed = await service.get(session, task_id)
        assert refreshed.status == "completed"


async def test_sync_releases_cache_on_terminal_state(app, upstream_client, tmp_path):
    """§3.4: 任务经状态同步进入终态时, 暂存文件被删除且 cache_dir 清空."""
    import os

    db = app.state.db
    upstream = UpstreamClient(upstream_client)
    cache = FileCache(str(tmp_path))
    writer = cache.create_streaming_cache()
    await writer.write_file_chunk("files", "a.pdf", "application/pdf", b"%PDF-1.4 data")
    cache_dir = await writer.finish({"backend": "pipeline"})
    assert os.path.isdir(cache_dir)

    async with db.session_factory() as session:
        key_id = await _seed_key(session)
        task = await _make_task(session, key_id, cache_dir=cache_dir)
        task_id = task.id

    mock_state.task_status = "completed"
    await status_sync.sync_once(db, upstream, poll_failure_threshold=3, cache=cache)

    assert not os.path.exists(cache_dir)
    async with db.session_factory() as session:
        refreshed = await service.get(session, task_id)
        assert refreshed.status == "completed"
        assert refreshed.cache_dir is None


async def test_sync_sets_completed_at_on_upstream_cancelled(app, upstream_client):
    """§4/§6.3: 经上游轮询检测到 cancelled 终态时, 也应写入 completed_at."""
    db = app.state.db
    upstream = UpstreamClient(upstream_client)
    async with db.session_factory() as session:
        key_id = await _seed_key(session)
        task = await _make_task(session, key_id)
        task_id = task.id

    mock_state.task_status = "cancelled"
    await status_sync.sync_once(db, upstream, poll_failure_threshold=3)

    async with db.session_factory() as session:
        refreshed = await service.get(session, task_id)
        assert refreshed.status == "cancelled"
        assert refreshed.completed_at is not None
