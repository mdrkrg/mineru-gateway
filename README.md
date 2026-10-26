# mineru-gateway

An API-key gateway in front of **mineru-api / mineru-router**. It keeps the parsing API transparent while adding access control, task history, crash recovery, and overload protection.

- Specification: [`specs/mvp-implementation.md`](specs/mvp-implementation.md)
- Architecture & tradeoffs: [`specs/architecture-design.md`](specs/architecture-design.md)
- Historical roadmap: [`plans/future-enhancements.md`](plans/future-enhancements.md)

> **API contract**: the gateway targets **MinerU 4.0** and its native `/v1`
> API.

> **Deployment constraint**: single instance, single worker (`uvicorn --workers 1`). Rate limiting and recovery state live in-process; running more than one worker is refused at startup.

## Features

- **Transparent proxying** of `POST /v1/file_parse` (sync) and `POST /v1/tasks` (async), including task status, results, cancellation, and `GET /v1/health`.
- **API-key auth** for parsing endpoints, with an admin token for key management and opt-in anonymous passthrough.
- **Task history** scoped per key, with list, detail, and result endpoints.
- **Crash recovery**: interrupted tasks are resubmitted automatically.
- **Protection**: per-key rate limiting, an optional global concurrency cap, and per-file/total upload limits.
- **Optional user accounts**: JWT/OAuth login and email verification (`GATEWAY_USER_AUTH_ENABLED`).
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
curl -X POST http://localhost:8000/v1/tasks \
  -H "X-API-Key: mru_..." \
  -F "files=@document.pdf" \
  -F "tier=standard"
```

Interactive API docs are served at `/docs` (OpenAPI at `/openapi.json`).

## Container (Docker / Podman)

Upstream mineru-router / mineru-api are **external** services; point the gateway at them with `GATEWAY_UPSTREAM_URL`.

```bash
export GATEWAY_UPSTREAM_URL="http://host.containers.internal:8002"
export GATEWAY_ADMIN_TOKEN="$(openssl rand -hex 16)"

podman compose -f container/compose.yaml up --build
```

The container applies Alembic migrations on start, then runs a single uvicorn worker. Task metadata lives in PostgreSQL; staged uploads (`/cache`) are kept in a named volume.

### Subpath deployment

- The bundled frontend can be mounted below a path such as `https://example.com/mineru`. Set `FRONTEND_BASE_PATH=/mineru` before building.
- The bundled Caddy serves the SPA at `/mineru/` and forwards `/mineru/api/*` to the Gateway after removing the public API prefix.

See [Subpath deployment](docs/subpath-deployment.md) for the complete setup and verification steps.

## Configuration

All settings use the `GATEWAY_` env prefix. The most important ones:

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_UPSTREAM_URL` | `http://127.0.0.1:8002` | Upstream router/api address (MinerU 4.0, `/v1` API) |
| `GATEWAY_UPSTREAM_API_KEY` | `""` | Bearer token when the upstream runs with `--api-key` |
| `GATEWAY_UPSTREAM_TIMEOUT_READ` | `600` | Upstream read timeout for sync parse/result, seconds (`/v1/tasks` uses 30s) |
| `GATEWAY_DATABASE_URL` | `sqlite+aiosqlite:///./gateway.db` | SQLite (default) or PostgreSQL |
| `GATEWAY_ADMIN_TOKEN` | `change-me` | Token required to manage API keys — **set this** |
| `GATEWAY_ALLOW_ANONYMOUS` | `false` | Allow keyless parse and opaque task-ID status/result/cancel passthrough (no history/listing) |
| `GATEWAY_GATEWAY_URL` | `http://127.0.0.1:8000` | Public API base URL used in generated links |
| `GATEWAY_ROOT_PATH` | `""` | Public API path prefix used for OpenAPI/docs behind a stripping proxy |
| `GATEWAY_MAX_UPLOAD_SIZE` | `524288000` | Max total file bytes per request (500 MiB) |
| `GATEWAY_MAX_FILE_SIZE` | `209715200` | Max bytes per file (200 MiB, MinerU 4.0's limit) |
| `GATEWAY_RATE_LIMIT_PER_KEY` | `10` | Requests per key per second |
| `GATEWAY_MAX_CONCURRENT_TASKS` | `0` | Global in-flight cap; `0` disables |
| `GATEWAY_FILE_CACHE_DIR` | `/tmp/gateway-cache` | Staged upload directory |
| `GATEWAY_TASK_RETENTION_DAYS` | `90` | Days to retain task records |
| `GATEWAY_ENABLE_BACKGROUND` | `true` | Run recovery and cleanup loops |
| `GATEWAY_USER_AUTH_ENABLED` | `false` | Enable JWT/OAuth/user routes |
| `GATEWAY_JWT_SECRET` | `change-me` | JWT signing secret; required (≥32 chars) when user auth is on |

The full list, including SMTP, OAuth providers, CORS, and recovery tuning, is documented in [`.env.example`](.env.example).

## Development

```bash
uv sync
uv run pytest
uv run alembic upgrade head
```
