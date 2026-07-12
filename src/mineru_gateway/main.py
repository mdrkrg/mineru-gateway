"""FastAPI application factory + lifespan wiring."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from .auth.routes import router as auth_router
from .background import cleanup, retry, status_sync
from .config import Settings, get_settings
from .db import Database
from .health.routes import router as health_router
from .limiter.memory import MemoryTokenBucket
from .logging_config import configure_logging
from .proxy.routes import router as proxy_router
from .tasks.cache import FileCache
from .tasks.routes import router as tasks_router
from .upstream.client import UpstreamClient


def create_app(
    settings: Settings | None = None,
    upstream_client: httpx.AsyncClient | None = None,
    create_tables: bool = True,
) -> FastAPI:
    settings = settings or get_settings()
    owns_upstream_client = upstream_client is None

    configure_logging(level=settings.log_level, json_logs=settings.json_logs)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(settings.database_url)
        if create_tables:
            await db.create_all()

        client = upstream_client or httpx.AsyncClient(
            base_url=settings.upstream_url, timeout=30.0
        )

        upstream = UpstreamClient(client)
        limiter = MemoryTokenBucket(
            rate=settings.rate_limit_per_key,
            burst=max(settings.rate_limit_per_key * 3, 1),
        )
        file_cache = FileCache(settings.file_cache_dir)

        app.state.settings = settings
        app.state.db = db
        app.state.upstream = upstream
        app.state.rate_limiter = limiter
        app.state.file_cache = file_cache

        tasks: list[asyncio.Task] = []
        if settings.enable_background:
            tasks.append(
                asyncio.create_task(
                    status_sync.status_sync_loop(
                        db,
                        upstream,
                        interval=settings.status_sync_interval,
                        poll_failure_threshold=settings.poll_failure_threshold,
                    )
                )
            )
            tasks.append(
                asyncio.create_task(
                    retry.retry_loop(
                        db,
                        upstream,
                        file_cache,
                        interval=settings.retry_interval,
                        max_retries=settings.max_retries,
                    )
                )
            )
            tasks.append(
                asyncio.create_task(
                    cleanup.cleanup_loop(
                        db,
                        limiter,
                        interval=settings.cleanup_interval,
                        retention_days=settings.task_retention_days,
                        cache=file_cache,
                    )
                )
            )

        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
            for task in tasks:
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
            if owns_upstream_client:
                await client.aclose()
            await db.dispose()

    app = FastAPI(title="mineru-gateway", version="0.1.0", lifespan=lifespan)
    app.include_router(auth_router)
    app.include_router(proxy_router)
    app.include_router(tasks_router)
    app.include_router(health_router)
    return app


def main() -> None:
    import uvicorn

    uvicorn.run(create_app(), host="0.0.0.0", port=8000, workers=1)


if __name__ == "__main__":
    main()
