"""Tests for Phase 3 crash retry.

Spec: mvp-implementation.md §3.4 (崩溃后简单重提), §6.4 (retry_loop, 固定 MAX_RETRIES).
Plan: Phase 3 — "上游故障检测 + 简单重提 (固定 MAX_RETRIES)".

Retryable tasks are those in status ``retry_pending`` whose cache_dir still
exists. Each test drives `retry_once` directly.
"""

from __future__ import annotations

import os

from mineru_gateway.background import retry
from mineru_gateway.tasks import service
from mineru_gateway.tasks.cache import FileCache
from mineru_gateway.upstream.client import UpstreamClient

from tests.mock_upstream import state as mock_state


async def _seed_key(session):
    from mineru_gateway.auth import service as auth_service

    record, _ = await auth_service.create_key(session, label="retry")
    return record.id


async def _retryable_task(session, cache, api_key_id, **overrides):
    writer = cache.create_streaming_cache()
    await writer.write_file_chunk("files", "a.pdf", "application/pdf", b"%PDF-1.4 data")
    cache_dir = await writer.finish({"backend": "pipeline"})
    fields = dict(
        api_key_id=api_key_id,
        status="retry_pending",
        upstream_url="http://mock-upstream",
        upstream_task_id="up-old",
        file_names=["a.pdf"],
        file_count=1,
        cache_dir=cache_dir,
    )
    fields.update(overrides)
    return await service.create(session, **fields)


async def test_retry_resubmits_when_upstream_healthy(app, upstream_client, tmp_path):
    """§6.4: 上游恢复健康后, 重提暂存任务 → 新 upstream_task_id, status=pending, retry_count+1."""
    db = app.state.db
    upstream = UpstreamClient(upstream_client)
    cache = FileCache(str(tmp_path))
    async with db.session_factory() as session:
        key_id = await _seed_key(session)
        task = await _retryable_task(session, cache, key_id)
        task_id = task.id

    await retry.retry_once(db, upstream, cache, max_retries=3)

    async with db.session_factory() as session:
        refreshed = await service.get(session, task_id)
        assert refreshed.status == "pending"
        assert refreshed.retry_count == 1
        assert refreshed.upstream_task_id != "up-old"
        assert refreshed.consecutive_poll_failures == 0


async def test_retry_skips_when_upstream_unhealthy(app, upstream_client, tmp_path):
    """§6.4: 上游未恢复 (非 healthy) 时不重提, 保持 retry_pending."""
    db = app.state.db
    upstream = UpstreamClient(upstream_client)
    cache = FileCache(str(tmp_path))
    async with db.session_factory() as session:
        key_id = await _seed_key(session)
        task = await _retryable_task(session, cache, key_id)
        task_id = task.id

    mock_state.status = "overloaded"
    await retry.retry_once(db, upstream, cache, max_retries=3)

    async with db.session_factory() as session:
        refreshed = await service.get(session, task_id)
        assert refreshed.status == "retry_pending"
        assert refreshed.retry_count == 0


async def test_retry_marks_failed_after_max_retries(app, upstream_client, tmp_path):
    """§6.4: 瞬时故障重试耗尽 (retry_count 达 MAX_RETRIES) → mark failed + 释放缓存."""
    db = app.state.db
    upstream = UpstreamClient(upstream_client)
    cache = FileCache(str(tmp_path))
    async with db.session_factory() as session:
        key_id = await _seed_key(session)
        task = await _retryable_task(session, cache, key_id, retry_count=2)
        task_id = task.id
        cache_dir = str(task.cache_dir)

    # Upstream healthy so retry is attempted, but submit raises → transient failure.
    mock_state.submit_raises = True
    await retry.retry_once(db, upstream, cache, max_retries=3)

    async with db.session_factory() as session:
        refreshed = await service.get(session, task_id)
        assert refreshed.status == "failed"
        assert refreshed.error_message

    assert not os.path.exists(cache_dir)


async def test_retry_marks_failed_on_malformed_response(app, upstream_client, tmp_path):
    """§6.4: 上游返回格式异常 (非 202/无 task_id) → 直接判 failed, 不消耗重试."""
    db = app.state.db
    upstream = UpstreamClient(upstream_client)
    cache = FileCache(str(tmp_path))
    async with db.session_factory() as session:
        key_id = await _seed_key(session)
        task = await _retryable_task(session, cache, key_id)
        task_id = task.id

    mock_state.submit_malformed = True
    await retry.retry_once(db, upstream, cache, max_retries=3)

    async with db.session_factory() as session:
        refreshed = await service.get(session, task_id)
        assert refreshed.status == "failed"
        # Non-transient failure must NOT consume a retry.
        assert refreshed.retry_count == 0


async def test_retry_marks_failed_on_non_json_202(app, upstream_client, tmp_path):
    """§6.4: 上游返回 202 但 body 非 JSON → 非瞬时故障, 直接判 failed, 不消耗重试."""
    db = app.state.db
    upstream = UpstreamClient(upstream_client)
    cache = FileCache(str(tmp_path))
    async with db.session_factory() as session:
        key_id = await _seed_key(session)
        task = await _retryable_task(session, cache, key_id)
        task_id = task.id

    mock_state.submit_raw_body = "not json"
    await retry.retry_once(db, upstream, cache, max_retries=3)

    async with db.session_factory() as session:
        refreshed = await service.get(session, task_id)
        assert refreshed.status == "failed"
        assert refreshed.retry_count == 0
