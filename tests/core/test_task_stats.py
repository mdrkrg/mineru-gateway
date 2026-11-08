"""Spec: GET /v1/tasks/stats - Task Statistics Endpoint

Returns per-status task counts and aggregate metrics scoped to the
authenticated principal's owner. Designed for dashboard overviews and
frontends that need a summary without paginating through all tasks.

Endpoint
--------
GET /v1/tasks/stats
  Security: X-API-Key or Bearer JWT (anonymous requests are rejected)
  Scope:    owner-based (specs/task-ownership.md). A user's keys and JWT share
            statistics; a key issued for another user only sees that user's.

Response (200)
--------------
  pending              : int   tasks waiting for upstream submission
  processing           : int   tasks currently being processed upstream
  retry_pending        : int   tasks flagged for resubmission after upstream crash
  completed            : int   tasks that finished successfully (all time)
  failed               : int   tasks in terminal failed state (all time)
  cancelled            : int   tasks cancelled by the user (all time)
  today_completed      : int   tasks that reached 'completed' status today (UTC)
  today_failed         : int   tasks that reached 'failed' status today (UTC)
  total_bytes          : int   sum of file_total_bytes across all tasks for this key
  avg_duration_ms      : float | null   average processing duration in milliseconds
                         (completed_at - started_at) for completed tasks;
                         null when there are no completed tasks

Behaviour
---------
- A key with no tasks returns all counts as 0 and null for avg_duration_ms.
- Counts are per owner: a user's keys and JWT share one set of statistics.
- The endpoint is read-only and has no side effects.
- Query parameters (status, date range, etc.) are intentionally NOT
  supported -- this is a fixed aggregate, not a filtered list.

Error cases
-----------
- Missing X-API-Key  -> 401
- Invalid X-API-Key  -> 401
"""

from __future__ import annotations

import uuid
from datetime import date as _date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from freezegun import freeze_time

from mineru_gateway.models import ApiKey, TaskRecord
from tests.conftest import create_key


# --- auth / access control ---


# Spec: "Missing X-API-Key -> 401"
async def test_task_stats_requires_auth(client):
    resp = await client.get("/v1/tasks/stats")
    assert resp.status_code == 401


# Spec: "Invalid X-API-Key -> 401"
async def test_task_stats_rejects_invalid_key(client):
    resp = await client.get("/v1/tasks/stats", headers={"X-API-Key": "not-a-valid-key"})
    assert resp.status_code == 401


# Spec: "two different API keys never see each other's statistics"
async def test_task_stats_ownership_isolation(client, api_key, admin_headers):
    # Create a second key under the admin.
    resp = await create_key(client, label="other")
    assert resp.status_code == 201
    other_key = resp.json()["api_key"]

    # Submit a task under the first key.
    files = [("files", ("doc.pdf", b"%PDF-1.4 data", "application/pdf"))]
    resp = await client.post("/v1/tasks", headers={"X-API-Key": api_key}, files=files)
    assert resp.status_code == 202
    task_id = resp.json()["task_id"]

    # Verify the first key can still see its own task.
    detail = await client.get(f"/v1/tasks/{task_id}", headers={"X-API-Key": api_key})
    assert detail.status_code == 200

    # First key should see non-zero pending count.
    first = await client.get("/v1/tasks/stats", headers={"X-API-Key": api_key})
    assert first.status_code == 200
    assert first.json()["pending"] >= 1

    # Second key with no tasks should see zero counts.
    second = await client.get("/v1/tasks/stats", headers={"X-API-Key": other_key})
    assert second.status_code == 200
    body = second.json()
    for field in (
        "pending",
        "processing",
        "retry_pending",
        "completed",
        "partial",
        "failed",
        "cancelled",
        "today_completed",
        "today_failed",
        "total_bytes",
    ):
        assert body[field] == 0, f"{field} should be 0 for a key with no tasks"
    assert body["avg_duration_ms"] is None


# Spec: keys of the same user share owner-scoped statistics.
async def test_task_stats_shared_between_owner_keys(client, user_headers):
    resp1 = await client.post(
        "/me/api-keys", json={"label": "key-alpha"}, headers=user_headers
    )
    assert resp1.status_code == 201
    key1 = resp1.json()["api_key"]

    resp2 = await client.post(
        "/me/api-keys", json={"label": "key-beta"}, headers=user_headers
    )
    assert resp2.status_code == 201
    key2 = resp2.json()["api_key"]

    files = [("files", ("doc.pdf", b"%PDF-1.4 data", "application/pdf"))]
    resp = await client.post("/v1/tasks", headers={"X-API-Key": key1}, files=files)
    assert resp.status_code == 202

    for headers in (
        {"X-API-Key": key1},
        {"X-API-Key": key2},
        user_headers,
    ):
        stats = await client.get("/v1/tasks/stats", headers=headers)
        assert stats.status_code == 200
        assert stats.json()["pending"] >= 1

    # A different user must not see the first user's statistics.
    other = await client.post(
        "/auth/register",
        json={
            "email": "other-stats-user@example.com",
            "password": "Str0ng!Pass",
        },
    )
    assert other.status_code == 201
    login = await client.post(
        "/auth/jwt/login",
        json={
            "email": "other-stats-user@example.com",
            "password": "Str0ng!Pass",
        },
    )
    assert login.status_code == 200
    other_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    isolated = await client.get("/v1/tasks/stats", headers=other_headers)
    assert isolated.status_code == 200
    assert isolated.json()["pending"] == 0


# --- zero state ---


# Spec: "A key with no tasks returns all counts as 0 and null for avg_duration_ms"
async def test_task_stats_defaults_to_zero_when_no_tasks(client, api_key):
    resp = await client.get("/v1/tasks/stats", headers={"X-API-Key": api_key})
    assert resp.status_code == 200
    body = resp.json()

    assert body["pending"] == 0
    assert body["processing"] == 0
    assert body["retry_pending"] == 0
    assert body["completed"] == 0
    assert body["failed"] == 0
    assert body["cancelled"] == 0
    assert body["today_completed"] == 0
    assert body["today_failed"] == 0
    assert body["total_bytes"] == 0
    assert body["avg_duration_ms"] is None


# Spec: "The endpoint is read-only and has no side effects"
# Verifies deterministic output for identical state.
async def test_task_stats_is_idempotent(client, api_key):
    first = await client.get("/v1/tasks/stats", headers={"X-API-Key": api_key})
    second = await client.get("/v1/tasks/stats", headers={"X-API-Key": api_key})
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()


# Spec: "Query parameters (status, date range, etc.) are intentionally NOT
#        supported -- this is a fixed aggregate, not a filtered list."
async def test_task_stats_ignores_query_params(client, api_key):
    no_params = await client.get("/v1/tasks/stats", headers={"X-API-Key": api_key})
    with_params = await client.get(
        "/v1/tasks/stats?status=completed&date_from=2020-01-01",
        headers={"X-API-Key": api_key},
    )
    assert no_params.status_code == 200
    assert with_params.status_code == 200
    assert no_params.json() == with_params.json()


# --- per-status counts ---


async def _seed_task(
    app, api_key_id, status, *, file_bytes=1024, started_at=None, completed_at=None
):
    """Insert a single TaskRecord directly via the DB for test setup."""
    if isinstance(api_key_id, str):
        api_key_id = uuid.UUID(api_key_id)

    async with app.state.db.session_factory() as session:
        key = await session.get(ApiKey, api_key_id)
        assert key is not None
        task = TaskRecord(
            owner_id=key.owner_id,
            api_key_id=api_key_id,
            status=status,
            file_names=["test.pdf"],
            file_count=1,
            file_total_bytes=file_bytes,
            tier="standard",
            upstream_url="http://mock-upstream",
            upstream_task_id=None,
            retry_count=0,
            consecutive_poll_failures=0,
            created_at=datetime.now(timezone.utc),
            started_at=started_at,
            completed_at=completed_at,
        )
        session.add(task)
        await session.commit()


# Spec: per-status counts (pending, processing, retry_pending, completed,
#        failed, cancelled)


async def test_task_stats_counts_by_status(app, client, admin_headers):
    # Create a fresh key and get its UUID.
    resp = await create_key(client, label="counts-test")
    assert resp.status_code == 201
    key_data = resp.json()
    api_key_str = key_data["api_key"]
    api_key_id = key_data["key_id"]

    # Seed tasks in various statuses.
    await _seed_task(app, api_key_id, "pending")
    await _seed_task(app, api_key_id, "pending")
    await _seed_task(app, api_key_id, "processing")
    await _seed_task(app, api_key_id, "retry_pending")
    await _seed_task(app, api_key_id, "completed")
    await _seed_task(app, api_key_id, "completed")
    await _seed_task(app, api_key_id, "completed")
    await _seed_task(app, api_key_id, "failed")
    await _seed_task(app, api_key_id, "cancelled")

    resp = await client.get("/v1/tasks/stats", headers={"X-API-Key": api_key_str})
    assert resp.status_code == 200
    body = resp.json()
    assert body["pending"] == 2
    assert body["processing"] == 1
    assert body["retry_pending"] == 1
    assert body["completed"] == 3
    assert body["failed"] == 1
    assert body["cancelled"] == 1


# Spec: "today_completed / today_failed" filter by UTC calendar day
# Patching date.today() forces the service's date-based computation to disagree
# with the UTC clock, exposing any implementation that derives today_start from
# the local calendar date instead of datetime.now(timezone.utc).
async def test_task_stats_today_counts_are_utc_scoped(app, client, admin_headers):
    # FastAPI >= 0.137 builds route dependants lazily on the first request.
    # Materialize them before freezing: freezegun rebinds ``datetime.date`` to
    # ``FakeDate`` in every imported module, which Pydantic rejects while
    # building the date query-param fields (fastapi#16034).
    app.openapi()
    # Fixed "now": July 1 2026 12:00 UTC, independent of the wall clock.
    today_start = datetime(2026, 7, 1, tzinfo=timezone.utc)
    yesterday = today_start - timedelta(days=1)

    resp = await create_key(client, label="today-test")
    assert resp.status_code == 201
    key_data = resp.json()
    api_key_str = key_data["api_key"]
    api_key_id = key_data["key_id"]

    # Today (July 1) completed tasks
    await _seed_task(app, api_key_id, "completed", completed_at=today_start)
    await _seed_task(
        app, api_key_id, "completed", completed_at=today_start + timedelta(hours=12)
    )
    # Yesterday (June 30) completed -- should NOT count in today_completed
    await _seed_task(app, api_key_id, "completed", completed_at=yesterday)
    # Today (July 1) failed
    await _seed_task(app, api_key_id, "failed", completed_at=today_start)
    # Yesterday (June 30) failed -- should NOT count in today_failed
    await _seed_task(app, api_key_id, "failed", completed_at=yesterday)

    with (
        freeze_time("2026-07-01T12:00:00"),
        patch(
            "datetime.date.today",
            return_value=_date(2026, 7, 2),
        ),
    ):
        resp = await client.get("/v1/tasks/stats", headers={"X-API-Key": api_key_str})
    assert resp.status_code == 200
    body = resp.json()
    # All-time counts include everything
    assert body["completed"] == 3
    assert body["failed"] == 2
    # Today counts only include tasks completed today UTC
    assert body["today_completed"] == 2
    assert body["today_failed"] == 1


# Spec: "total_bytes = sum of file_total_bytes across all tasks for this key"


async def test_task_stats_total_bytes(app, client, admin_headers):
    resp = await create_key(client, label="bytes-test")
    assert resp.status_code == 201
    key_data = resp.json()
    api_key_str = key_data["api_key"]
    api_key_id = key_data["key_id"]

    await _seed_task(app, api_key_id, "pending", file_bytes=100)
    await _seed_task(app, api_key_id, "completed", file_bytes=250)
    await _seed_task(app, api_key_id, "failed", file_bytes=50)
    await _seed_task(app, api_key_id, "cancelled", file_bytes=75)

    resp = await client.get("/v1/tasks/stats", headers={"X-API-Key": api_key_str})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_bytes"] == 475


# Spec: "avg_duration_ms = average of (completed_at - started_at) for
#        completed tasks; null when no completed tasks exist"


async def test_task_stats_avg_duration(app, client, admin_headers):
    now = datetime.now(timezone.utc)

    resp = await create_key(client, label="duration-test")
    assert resp.status_code == 201
    key_data = resp.json()
    api_key_str = key_data["api_key"]
    api_key_id = key_data["key_id"]

    # Two completed tasks with known durations.
    # Task 1: started 10 min ago, completed now -> 600_000 ms
    await _seed_task(
        app,
        api_key_id,
        "completed",
        started_at=now - timedelta(minutes=10),
        completed_at=now,
    )
    # Task 2: started 5 min ago, completed now -> 300_000 ms
    await _seed_task(
        app,
        api_key_id,
        "completed",
        started_at=now - timedelta(minutes=5),
        completed_at=now,
    )
    # Task 3: still processing, should not affect avg_duration
    await _seed_task(
        app,
        api_key_id,
        "processing",
        started_at=now - timedelta(minutes=2),
    )
    # Task 4: failed, should not affect avg_duration
    await _seed_task(
        app,
        api_key_id,
        "failed",
        started_at=now - timedelta(minutes=8),
        completed_at=now,
    )

    resp = await client.get("/v1/tasks/stats", headers={"X-API-Key": api_key_str})
    assert resp.status_code == 200
    body = resp.json()

    # Assert avg is roughly 450_000 ms (10 min + 5 min avg = 7.5 min = 450,000 ms)
    avg = body["avg_duration_ms"]
    assert avg is not None
    assert avg == pytest.approx(450_000, rel=0.001)

    # avg_duration_ms should be null for a key with no completed tasks
    resp2 = await create_key(client, label="no-completed")
    assert resp2.status_code == 201
    empty_key = resp2.json()["api_key"]
    empty_key_id = resp2.json()["key_id"]
    await _seed_task(app, empty_key_id, "pending")
    await _seed_task(app, empty_key_id, "processing")
    await _seed_task(app, empty_key_id, "failed", completed_at=now)

    resp3 = await client.get("/v1/tasks/stats", headers={"X-API-Key": empty_key})
    assert resp3.status_code == 200
    assert resp3.json()["avg_duration_ms"] is None


async def test_task_stats_response_has_only_expected_keys(client, api_key):
    resp = await client.get("/v1/tasks/stats", headers={"X-API-Key": api_key})
    assert resp.status_code == 200
    body = resp.json()
    expected_keys = {
        "pending",
        "processing",
        "retry_pending",
        "completed",
        "partial",
        "failed",
        "cancelled",
        "today_completed",
        "today_failed",
        "total_bytes",
        "avg_duration_ms",
    }
    assert set(body.keys()) == expected_keys
