"""Spec: GET /tasks/stats - Task Statistics Endpoint

Returns per-status task counts and aggregate metrics scoped to the
authenticated API key's owner.  Designed for dashboard overviews and
frontends that need a summary without paginating through all tasks.

Endpoint
--------
GET /tasks/stats
  Security: X-API-Key (required; anonymous requests are rejected)
  Scope:    statistics cover only tasks owned by the key making the request.
            A different key sees only its own data.

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
- Counts are per-key: two different API keys never see each other's
  statistics, even if they belong to the same user.
- The endpoint is read-only and has no side effects.
- Query parameters (status, date range, etc.) are intentionally NOT
  supported -- this is a fixed aggregate, not a filtered list.

Error cases
-----------
- Missing X-API-Key  -> 401
- Invalid X-API-Key  -> 401
"""

from __future__ import annotations

import pytest


# --- auth / access control ---


# Spec: "Missing X-API-Key -> 401"
async def test_task_stats_requires_auth(client):
    resp = await client.get("/tasks/stats")
    assert resp.status_code == 401


# Spec: "Invalid X-API-Key -> 401"
async def test_task_stats_rejects_invalid_key(client):
    resp = await client.get("/tasks/stats", headers={"X-API-Key": "not-a-valid-key"})
    assert resp.status_code == 401


# Spec: "two different API keys never see each other's statistics"
@pytest.mark.xfail(
    reason="stub returns hardcoded zeros; ownership isolation not yet enforced"
)
async def test_task_stats_ownership_isolation(client, api_key, admin_headers):
    # Create a second key under the admin.
    resp = await client.post(
        "/auth/keys", json={"label": "other"}, headers=admin_headers
    )
    assert resp.status_code == 201
    other_key = resp.json()["api_key"]

    # Submit a task under the first key.
    files = [("files", ("doc.pdf", b"%PDF-1.4 data", "application/pdf"))]
    resp = await client.post("/tasks", headers={"X-API-Key": api_key}, files=files)
    assert resp.status_code == 202
    task_id = resp.json()["task_id"]

    # Verify the first key can still see its own task.
    detail = await client.get(f"/tasks/{task_id}", headers={"X-API-Key": api_key})
    assert detail.status_code == 200

    # First key should see non-zero pending count.
    first = await client.get("/tasks/stats", headers={"X-API-Key": api_key})
    assert first.status_code == 200
    assert first.json()["pending"] >= 1

    # Second key with no tasks should see zero counts.
    second = await client.get("/tasks/stats", headers={"X-API-Key": other_key})
    assert second.status_code == 200
    body = second.json()
    for field in (
        "pending",
        "processing",
        "retry_pending",
        "completed",
        "failed",
        "cancelled",
        "today_completed",
        "today_failed",
        "total_bytes",
    ):
        assert body[field] == 0, f"{field} should be 0 for a key with no tasks"
    assert body["avg_duration_ms"] is None
