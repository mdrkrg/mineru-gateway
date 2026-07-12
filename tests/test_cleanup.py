"""Tests for Phase 3 cleanup: expired task records + cache files + limiter prune.

Spec: mvp-implementation.md §3.4 (文件缓存自动清理 / DB 记录保留至 TTL),
§6.5 (限流器 prune).
Plan: Phase 3 — "过期任务 + 缓存清理".
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone


from mineru_gateway.background import cleanup
from mineru_gateway.limiter.memory import MemoryTokenBucket
from mineru_gateway.tasks import service


async def _seed_key(session):
    from mineru_gateway.auth import service as auth_service

    record, _ = await auth_service.create_key(session, label="cln")
    return record.id


async def test_cleanup_deletes_expired_records(app):
    """§3.4: 超过保留 TTL 的任务记录被删除."""
    db = app.state.db
    async with db.session_factory() as session:
        key_id = await _seed_key(session)
        old = await service.create(
            session,
            api_key_id=key_id,
            status="completed",
            upstream_url="http://mock-upstream",
            file_names=["old.pdf"],
            file_count=1,
        )
        # Backdate created_at beyond retention.
        old.created_at = datetime.now(timezone.utc) - timedelta(days=100)
        await session.commit()
        old_id = old.id

        recent = await service.create(
            session,
            api_key_id=key_id,
            status="completed",
            upstream_url="http://mock-upstream",
            file_names=["new.pdf"],
            file_count=1,
        )
        recent_id = recent.id

    limiter = MemoryTokenBucket()
    await cleanup.cleanup_once(db, limiter, retention_days=90)

    async with db.session_factory() as session:
        assert await service.get(session, old_id) is None
        assert await service.get(session, recent_id) is not None


async def test_cleanup_prunes_limiter(app):
    """§6.5: 清理循环调用 limiter.prune() 回收空闲 key."""
    db = app.state.db
    limiter = MemoryTokenBucket(idle_ttl=-1)
    await limiter.acquire("stale")
    assert "stale" in limiter._state

    await cleanup.cleanup_once(db, limiter, retention_days=90)
    assert "stale" not in limiter._state
