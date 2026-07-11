"""FastAPI application factory + lifespan wiring."""

from __future__ import annotations

from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from .auth.routes import router as auth_router
from .config import Settings, get_settings
from .db import Database
from .health.routes import router as health_router
from .limiter.memory import MemoryTokenBucket
from .proxy.routes import router as proxy_router
from .tasks.routes import router as tasks_router
from .upstream.client import UpstreamClient


def create_app(
    settings: Settings | None = None,
    upstream_client: httpx.AsyncClient | None = None,
    create_tables: bool = True,
) -> FastAPI:
    settings = settings or get_settings()
    owns_upstream_client = upstream_client is None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(settings.database_url)
        if create_tables:
            await db.create_all()

        client = upstream_client or httpx.AsyncClient(
            base_url=settings.upstream_url, timeout=30.0
        )

        app.state.settings = settings
        app.state.db = db
        app.state.upstream = UpstreamClient(client)
        app.state.rate_limiter = MemoryTokenBucket(
            rate=settings.rate_limit_per_key,
            burst=max(settings.rate_limit_per_key * 3, 1),
        )
        try:
            yield
        finally:
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
