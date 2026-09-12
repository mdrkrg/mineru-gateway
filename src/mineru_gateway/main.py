"""FastAPI application factory + lifespan wiring."""

from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from .auth.api_keys_me import router as api_keys_me_router
from .auth.jwt_routes import router as jwt_router
from .auth.oauth.routes import router as oauth_router
from .auth.routes import router as auth_router
from .auth.user_routes import router as user_router
from .background import cleanup, retry, status_sync
from .config import Settings, get_settings
from .db import Database
from .health.routes import router as health_router
from .limiter.memory import MemoryTokenBucket
from .logging_config import configure_logging
from .middleware import RequestLoggingMiddleware
from .proxy.routes import router as proxy_router
from .tasks.cache import FileCache
from .tasks.routes import router as tasks_router
from .upstream.client import UpstreamClient

logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    upstream_client: httpx.AsyncClient | None = None,
    create_tables: bool | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    owns_upstream_client = upstream_client is None
    if create_tables is None:
        create_tables = settings.create_tables

    # TODO: Support multi-worker
    if settings.workers > 1:
        logger.error(
            "GATEWAY_WORKERS=%s is not supported. Multiple uvicorn workers "
            "cause duplicated rate-limiting, duplicate background-loop runs, "
            "and retry races. Set GATEWAY_WORKERS=1 to start.",
            settings.workers,
        )
        sys.exit(1)

    # Section 3.1 / 7.1: validate jwt_secret when user_auth_enabled
    if settings.user_auth_enabled and len(settings.jwt_secret) < 32:
        raise ValueError(
            "GATEWAY_JWT_SECRET must be at least 32 characters when "
            "GATEWAY_USER_AUTH_ENABLED is true"
        )

    # Spec: email-verification.md Section 3.1: with user auth enabled and the
    # verification gate closed, SMTP must be configured or unverified users
    # have no verification path and are locked out of protected features.
    if (
        settings.user_auth_enabled
        and not settings.allow_unverified_accounts
        and settings.smtp_host is None
    ):
        raise ValueError(
            "GATEWAY_USER_AUTH_ENABLED=true with "
            "GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS=false requires GATEWAY_SMTP_HOST; "
            "configure SMTP or set GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS=true"
        )

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
                        cache=file_cache,
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
                except (asyncio.CancelledError, Exception):  # fmt: skip
                    pass
            if owns_upstream_client:
                await client.aclose()
            await db.dispose()

    app = FastAPI(title="mineru-gateway", version="0.1.0", lifespan=lifespan)
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_methods=settings.cors_allow_methods,
        allow_headers=settings.cors_allow_headers,
        allow_credentials=settings.cors_allow_credentials,
        max_age=settings.cors_max_age,
    )

    @app.exception_handler(Exception)
    async def _exception_handler(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled exception: %s", exc)
        return JSONResponse(
            status_code=500, content={"detail": "Internal server error"}
        )

    # Section 6.3: always-registered routes
    app.include_router(auth_router)
    app.include_router(proxy_router)
    app.include_router(tasks_router)
    app.include_router(health_router)

    # Section 6.3: user-auth routes only when USER_AUTH_ENABLED=true
    if settings.user_auth_enabled:
        app.include_router(jwt_router)
        app.include_router(user_router)
        app.include_router(api_keys_me_router)
        app.include_router(oauth_router)
        # Spec: email-verification.md Section 1/6.1 - verify routes are only
        # registered when SMTP is configured (unset -> 404, matching the
        # USER_AUTH_ENABLED=false pattern).
        if settings.smtp_host:
            from fastapi_users.router.verify import get_verify_router

            from .auth.manager import get_user_manager
            from .auth.schemas import UserRead
            from .auth.verify_routes import router as verify_router

            app.include_router(
                get_verify_router(get_user_manager, UserRead), prefix="/auth"
            )
            app.include_router(verify_router)

    return app


def main() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run(create_app(), host="0.0.0.0", port=8000, workers=settings.workers)


if __name__ == "__main__":
    main()
