# mineru-gateway

An API-Key gateway that sits in front of **mineru-api / mineru-router**. It
transparently proxies the legacy parsing API while adding access control, task
persistence, basic disaster recovery, and protection against upstream overload.

- Specification: [`specs/mvp-implementation.md`](specs/mvp-implementation.md)
- Architecture & tradeoffs: [`specs/architecture-design.md`](specs/architecture-design.md)
- Roadmap: [`plans/mvp-implementation-plan.md`](plans/mvp-implementation-plan.md)

> **Deployment constraint**: single instance, single worker
> (`uvicorn --workers 1`). The in-memory rate limiter and background loops keep
> state in-process; multiple workers/instances would double-count or duplicate
> work. Horizontal scaling is out of scope for the MVP.

## Features

- **Transparent proxy** of `POST /file_parse` (sync) and `POST /tasks` (async),
  plus `GET /tasks/{id}`, `GET /tasks/{id}/result`, `GET /health`.
- **API Key auth** (no user system). Keys are issued/revoked with an admin
  token and stored as SHA256 hashes. Anonymous passthrough is opt-in.
- **Task persistence & isolation**: authenticated submissions are recorded and
  scoped per key; list/detail/cancel endpoints enforce ownership.
- **Disaster recovery**: original uploads are staged to disk; background loops
  sync status from upstream and resubmit crashed tasks (fixed `MAX_RETRIES`).
- **Protection**: health-aware submission gating, per-key token-bucket rate
  limiting, an optional global concurrency cap, and an upload size limit.
- **Observability**: structured JSON logs and an aggregated health endpoint.

## Quick start (local)

```bash
uv sync

export GATEWAY_UPSTREAM_URL="http://127.0.0.1:8002"
export GATEWAY_ADMIN_TOKEN="$(openssl rand -hex 16)"

uv run alembic upgrade head
uv run uvicorn mineru_gateway.main:create_app --factory --port 8000 --workers 1
```

Issue an API key (requires the admin token):

```bash
curl -X POST http://localhost:8000/auth/keys \
  -H "X-Admin-Token: $GATEWAY_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "production"}'
```

Submit an async task with the returned key:

```bash
curl -X POST http://localhost:8000/tasks \
  -H "X-API-Key: mru_..." \
  -F "files=@document.pdf" \
  -F "backend=pipeline"
```

Interactive API docs are served at `/docs` (OpenAPI at `/openapi.json`).

## Docker

Upstream mineru-router / mineru-api are treated as **external** services; pass
their address via `GATEWAY_UPSTREAM_URL`.

```bash
export GATEWAY_UPSTREAM_URL="http://host.docker.internal:8002"
export GATEWAY_ADMIN_TOKEN="$(openssl rand -hex 16)"

docker compose up --build
```

The container runs `alembic upgrade head` on start, then a single uvicorn
worker. Task metadata (`/data`) and staged uploads (`/cache`) are persisted in
named volumes.

## Configuration

All settings use the `GATEWAY_` env prefix.

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_UPSTREAM_URL` | `http://127.0.0.1:8002` | Upstream router/api address |
| `GATEWAY_DATABASE_URL` | `sqlite+aiosqlite:///./gateway.db` | SQLite (default) or PostgreSQL |
| `GATEWAY_ADMIN_TOKEN` | `change-me` | Token required to manage API keys — **set this** |
| `GATEWAY_ALLOW_ANONYMOUS` | `false` | Allow keyless pure passthrough |
| `GATEWAY_GATEWAY_URL` | `http://127.0.0.1:8000` | Public base URL used in status/result links |
| `GATEWAY_MAX_UPLOAD_SIZE` | `524288000` | Max upload per request, bytes (500MB) |
| `GATEWAY_RATE_LIMIT_PER_KEY` | `10` | Requests per key per second |
| `GATEWAY_MAX_CONCURRENT_TASKS` | `0` | Global in-flight cap; `0` disables |
| `GATEWAY_FILE_CACHE_DIR` | `/tmp/gateway-cache` | Staged upload directory |
| `GATEWAY_TASK_RETENTION_DAYS` | `90` | Days to retain task records |
| `GATEWAY_ENABLE_BACKGROUND` | `true` | Run status-sync / retry / cleanup loops |
| `GATEWAY_STATUS_SYNC_INTERVAL` | `5.0` | Status sync loop interval (s) |
| `GATEWAY_RETRY_INTERVAL` | `10.0` | Retry loop interval (s) |
| `GATEWAY_CLEANUP_INTERVAL` | `3600.0` | Cleanup loop interval (s) |
| `GATEWAY_MAX_RETRIES` | `3` | Max crash-resubmission attempts |
| `GATEWAY_POLL_FAILURE_THRESHOLD` | `3` | Consecutive poll failures before marking retryable |
| `GATEWAY_JSON_LOGS` | `true` | Emit structured JSON logs |
| `GATEWAY_LOG_LEVEL` | `INFO` | Log level |
| `GATEWAY_CORS_ALLOW_ORIGINS` | `*` | Allowed origins (comma-separated or JSON array) |
| `GATEWAY_CORS_ALLOW_METHODS` | `*` | Allowed HTTP methods |
| `GATEWAY_CORS_ALLOW_HEADERS` | `*` | Allowed request headers |
| `GATEWAY_CORS_ALLOW_CREDENTIALS` | `false` | Allow credentials in cross-origin requests |
| `GATEWAY_CORS_MAX_AGE` | `600` | Preflight response cache duration (s) |

## Development

```bash
uv sync
uv run pytest            # run the test suite
uv run alembic upgrade head
```

Tests are organised in three layers:

| Layer | Command | Transport | Count |
|-------|---------|-----------|-------|
| Unit / integration | `uv run pytest tests/core/ tests/user/` | ASGI (in-process mock) | 289 |
| Mock E2E | `uv run pytest tests/e2e/ -m e2e` | Real HTTP (subprocess gateway + mock upstream) | 9 |
| Real E2E | `GATEWAY_REAL_UPSTREAM_URL=... uv run pytest tests/e2e/ -m real_upstream` | Real HTTP against real mineru (falls back to mock) | 4 |

```bash
uv run pytest                            # all 302 tests
uv run pytest tests/e2e/ -m e2e          # mock HTTP e2e only
uv run pytest tests/e2e/ -m real_upstream  # real upstream e2e
```
