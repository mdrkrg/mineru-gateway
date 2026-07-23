"""Spec: GET /tasks/stats - Task Statistics Endpoint

Returns per-status task counts and aggregate metrics scoped to the
authenticated API key's owner.
Designed for dashboard overviews and frontends that need a summary
without paginating through all tasks.

Endpoint
--------
GET /tasks/stats
  Security: X-API-Key (required; anonymous requests are rejected)
  Scope:    statistics cover only tasks owned by the key making the request.
            A different key sees only its own data.

Response (200)
--------------
  pending          : int   tasks waiting for upstream submission
  processing       : int   tasks currently being processed upstream
  retry_pending    : int   tasks flagged for resubmission after upstream crash
  completed        : int   tasks that finished successfully (all time)
  failed           : int   tasks in terminal failed state (all time)
  cancelled        : int   tasks cancelled by the user (all time)
  today_completed  : int   tasks that reached 'completed' status today (UTC)
  today_failed     : int   tasks that reached 'failed' status today (UTC)
  total_bytes      : int   sum of file_total_bytes across all tasks for this key
  avg_duration_ms  : float | null   average processing duration in milliseconds
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
- Missing or invalid X-API-Key  -> 401
"""
