"""Unit tests for the in-process token bucket limiter.

Notably guards the review-found bug: acquire() is async and must actually block
once the burst budget is exhausted.
"""

from __future__ import annotations

import pytest

from mineru_gateway.limiter.memory import MemoryTokenBucket


async def test_acquire_is_async_and_blocks_after_burst():
    bucket = MemoryTokenBucket(rate=1, burst=3)
    # First `burst` acquisitions succeed.
    for _ in range(3):
        assert await bucket.acquire("k") is True
    # Next one is denied (no tokens left, ~no time elapsed).
    assert await bucket.acquire("k") is False


async def test_acquire_is_per_key():
    bucket = MemoryTokenBucket(rate=1, burst=1)
    assert await bucket.acquire("a") is True
    assert await bucket.acquire("a") is False
    # Different key has its own budget.
    assert await bucket.acquire("b") is True


async def test_prune_removes_idle_keys():
    bucket = MemoryTokenBucket(rate=1, burst=1, idle_ttl=-1)
    await bucket.acquire("stale")
    assert "stale" in bucket._state
    await bucket.prune()
    assert "stale" not in bucket._state


async def test_rate_limit_enforced_via_endpoint(client, admin_headers, sample_files):
    created = (
        await client.post("/auth/keys", json={"label": "rl"}, headers=admin_headers)
    ).json()
    raw = created["api_key"]
    # burst defaults to rate*3 = 30; drive enough requests to hit 429.
    hit_429 = False
    for _ in range(40):
        resp = await client.post(
            "/tasks", headers={"X-API-Key": raw}, files=sample_files
        )
        if resp.status_code == 429:
            hit_429 = True
            assert resp.headers.get("Retry-After") == "60"
            break
    assert hit_429
