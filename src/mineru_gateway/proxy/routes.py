"""MinerU V1 proxy endpoints: POST /v1/tasks and /v1/file_parse."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import get_session, require_task_principal
from ..auth.principals import TaskPrincipal, ensure_can_create_tasks
from ..config import Settings
from ..tasks.cache import FileCache
from ..upstream.client import UpstreamClient
from .handler import handle_file_parse, handle_task_submission

router = APIRouter(prefix="/v1")


async def _settings(req: Request) -> Settings:
    return req.app.state.settings


async def _upstream(req: Request) -> UpstreamClient:
    return req.app.state.upstream


async def _limiter(req: Request):
    return req.app.state.rate_limiter


async def _cache(req: Request) -> FileCache:
    return req.app.state.file_cache


@router.post("/tasks")
async def submit_task(
    request: Request,
    principal: TaskPrincipal | None = Depends(require_task_principal),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
    limiter=Depends(_limiter),
    cache: FileCache = Depends(_cache),
    settings: Settings = Depends(_settings),
    x_idempotency_key: str | None = Header(None, alias="X-Idempotency-Key"),
):
    ensure_can_create_tasks(principal, settings)
    return await handle_task_submission(
        request=request,
        principal=principal,
        session=session,
        upstream=upstream,
        limiter=limiter,
        cache=cache,
        settings=settings,
        x_idempotency_key=x_idempotency_key,
    )


@router.post("/file_parse")
async def parse_file(
    request: Request,
    principal: TaskPrincipal | None = Depends(require_task_principal),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
    limiter=Depends(_limiter),
    cache: FileCache = Depends(_cache),
    settings: Settings = Depends(_settings),
):
    ensure_can_create_tasks(principal, settings)
    return await handle_file_parse(
        request=request,
        principal=principal,
        session=session,
        upstream=upstream,
        limiter=limiter,
        cache=cache,
        settings=settings,
    )
