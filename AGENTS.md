# AGENTS.md

## What this is

`mineru-gateway` is an API-Key gateway that proxies `mineru-api` / `mineru-router`
(document parsing). It adds API key auth, task persistence, disaster-recovery
background loops, rate limiting, and structured logging. See `README.md` for
the user-facing overview and `specs/` for design docs.

## Stack & version requirements

See `pyproject.toml`.

- **Python >=3.14**
- **FastAPI** + **Uvicorn** (ASGI, single worker)
- **SQLAlchemy 2.0 async** + **aiosqlite** (default) or PostgreSQL
- **Alembic** migrations
- **httpx** for upstream calls
- **python-multipart** for streaming multipart parsing
- **aiofiles** for non-blocking file I/O during upload streaming
- **fastapi-users** for the optional JWT/OAuth user system
- **pydantic-settings** (`GATEWAY_` env prefix)
- **uv** is the package manager; lockfile is `uv.lock`
- **ruff** for lint + format (no black, no flake8, no isort)
- **pytest** + **pytest-asyncio** (`asyncio_mode = "auto"`)

## Essential commands

```bash
uv sync                                              # install deps from uv.lock
uv run pytest                                        # run the test suite
uv run pytest tests/core/test_tasks.py               # run a single test file
uv run pytest -k status_sync                         # run tests matching a name
uv run ruff check .                                  # lint
uv run ruff format .                                 # format
uv run ruff check --fix .                            # lint + autofix
uv run alembic upgrade head                          # apply migrations
uv run alembic revision --autogenerate -m "msg"      # create a migration
uv run pytest tests/e2e/ -m e2e                       # mock HTTP e2e (subprocess gateway)
uv run pytest tests/e2e/ -m real_upstream             # real upstream e2e (fallback to mock)
uv run uvicorn mineru_gateway.main:create_app --factory --port 8000 --workers 1
```

**Before considering work done, run:** `uv run ruff check . && uv run ruff format --check . && uv run pytest`.

Install pre-commit hooks (`uv run pre-commit install`) to auto-run ruff-check, ruff-format, and uv-lock before commit.

## Mock e2e runner

```bash
# Start mock upstream + gateway (backend only)
uv run python tests/e2e/run_mock.py

# Start mock upstream + gateway + frontend (when frontend/ is present)
uv run python tests/e2e/run_mock.py --frontend
```

This starts three services on auto-assigned ports.
See `docs/mock-upstream.md` for the mock control API reference.

## Critical constraints

- **Single instance, single worker only.** `uvicorn --workers 1`. The rate limiter
  (`limiter/memory.py`) and the three background asyncio loops
  (`background/status_sync.py`, `retry.py`, `cleanup.py`) keep state in-process.
  Multiple workers would double-count and duplicate work. See `plans/multi-worker-scaling.md`.
- **Never run `ruff` against `alembic/versions/`** - it's excluded in `pyproject.toml`.
- **`create_tables=True` is for tests only** (`config.py`); production relies on
  Alembic migrations. The Docker entrypoint runs `alembic upgrade head` on boot.
- **Tests must not hit the network.** `tests/conftest.py` swaps the upstream
  `httpx.AsyncClient` with an `ASGITransport` pointed at `tests/mock_upstream.py`.
  Keep that pattern when adding tests that call upstream.

## Code organization

Single Python package: `src/mineru_gateway/`. Each domain is a sub-package with
the same internal layout - **routes / service / schemas** is the canonical split:

| Package | Responsibility |
|---------|----------------|
| `main.py` | `create_app()` factory + `lifespan` that wires `app.state.*` and spawns background loops |
| `config.py` | `Settings` (pydantic-settings, `GATEWAY_` prefix) + `@lru_cache get_settings()` |
| `db.py` | async engine + `async_sessionmaker` |
| `models.py` | SQLAlchemy ORM: `ApiKey`, `TaskRecord`, `User`, `OAuthAccount` |
| `schemas.py` | shared Pydantic schemas |
| `middleware.py` | pure-ASGI `RequestLoggingMiddleware` (one JSON log per request, `x-request-id`) |
| `logging_config.py` | structured JSON logging setup |
| `auth/` | API keys (default) + opt-in JWT/OAuth via `fastapi-users` |
| `proxy/` | transparent passthrough of `/file_parse` and `/tasks`; streaming multipart parser for uploads |
| `tasks/` | task CRUD + batch, `FileCache` for staged uploads, `CacheWriter` for streaming writes |
| `background/` | `status_sync`, `retry`, `cleanup` asyncio loops |
| `upstream/` | `httpx` wrapper + `/health` aggregation |
| `health/` | aggregated `/health` endpoint |
| `limiter/` | in-memory per-key token bucket |
| `utils/` | small helpers (e.g. `uuid.py`) |

### Where things live when adding a feature

- New endpoint? -> add a route in the relevant domain's `routes.py`, register the
  router in `main.py` (lines ~137-147).
- New env var? -> add to `Settings` in `config.py`, document in `.env.example` and
  the table in `README.md`.
- New DB column? -> add the field to the model in `models.py`, then
  `uv run alembic revision --autogenerate -m "describe"` and review the generated
  file in `alembic/versions/`. **Do not hand-edit existing migrations.**
- New background loop? -> add in `background/`, then start it in `main.py`'s
  lifespan guarded by `settings.enable_background`.

## Conventions

- **State is wired through `app.state.*`**, set in the lifespan (`main.py:60-131`).
  Access via `request.app.state.<thing>` or FastAPI `Depends`. No module-level globals.
- **Routers** use `APIRouter(prefix="...", tags=[...])`. Endpoints are `async def`.
- **Pydantic v2** for all request/response schemas. SQLAlchemy models stay in
  `models.py`; do not return ORM objects directly - convert via schemas.
- **Async everywhere.** No blocking calls. Use `httpx.AsyncClient`, `aiosqlite`,
  `asyncio.*` primitives.
- **Sync callbacks in multipart parsing**: `python_multipart.MultipartParser`
  callbacks are synchronous. File chunk data is queued during callback
  execution and drained with `await` after each `parser.write(chunk)` returns.
  This is the only allowed sync-in-async pattern in the codebase.
- **Logging** uses the structured logger from `logging_config.py`. Include
  `request_id`, `api_key_id`, etc. where relevant. Do not `print()`.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat/test/docs/fix(scope): title

optional concise body
```

- **Type** (required): `feat`, `test`, `docs`, `fix` (also `chore`, `refactor`,
  `perf`, `style`, `ci`, `build` when appropriate).
- **Scope** (optional): the affected domain - `auth`, `proxy`, `tasks`,
  `streaming`, `cache`, `background`, `health`, `limiter`, `upstream`, `db`,
  `config`, `tests`, etc.
- **Title**: imperative mood, lowercase, no trailing period, ≤72 chars.
- **Body** (optional): one blank line after the title, wrap at ~72 cols, explain
  the *why* (the diff already shows the *what*).

Examples:

```
feat(tasks): add batch submission endpoint
fix(background): stop retry loop double-counting in-flight tasks
docs(README): document GATEWAY_MAX_CONCURRENT_TASKS
test(auth): cover anonymous passthrough toggle
```

## Tests

- Layout: `tests/core/` (gateway mechanics) and `tests/user/` (opt-in user-auth
  feature). Shared fixtures in `tests/conftest.py`.
- `asyncio_mode = "auto"` - test functions are `async def` without decorators.
- The app is built per-test via the `app` fixture, which injects the mock
  upstream. Prefer extending `tests/mock_upstream.py` over mocking `httpx` directly.
- Run the whole suite before finishing: `uv run pytest`.

## Configuration reference

All settings use the `GATEWAY_` env prefix. Full table is in `README.md` and
`.env.example`. Key ones to know:

- `GATEWAY_UPSTREAM_URL` - the mineru-router/api to proxy to.
- `GATEWAY_ADMIN_TOKEN` - required to issue/revoke API keys. **Set this in any
  non-test environment.**
- `GATEWAY_USER_AUTH_ENABLED` - toggles the JWT/OAuth/user-management routers
  (registered conditionally in `main.py`).
- `GATEWAY_ENABLE_BACKGROUND` - gates the three asyncio loops. Disable in tests
  that don't need them.

## Specs & plans

Before making non-trivial design changes, read the relevant doc:

- `specs/architecture-design.md` - overall design & tradeoffs
- `specs/mvp-implementation.md` - MVP feature spec
- `specs/streaming-upload.md` - streaming multipart upload design
- `specs/batch-endpoints.md`, `specs/idempotent-submission.md`,
  `specs/user-management-and-oauth.md` - feature specs
- `plans/mvp-implementation-plan.md`, `plans/multi-worker-scaling.md`,
  `plans/future-enhancements.md` - roadmaps
