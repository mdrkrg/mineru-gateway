"""Proxy endpoints: POST /tasks, POST /file_parse (Phase 1)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import get_session, require_api_key
from ..config import Settings
from ..models import ApiKey
from ..tasks.cache import FileCache
from ..upstream.client import UpstreamClient
from .handler import handle_file_parse, handle_task_submission

router = APIRouter()


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
    api_key: ApiKey | None = Depends(require_api_key),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
    limiter=Depends(_limiter),
    cache: FileCache = Depends(_cache),
    settings: Settings = Depends(_settings),
):
    return await handle_task_submission(
        request=request,
        api_key=api_key,
        session=session,
        upstream=upstream,
        limiter=limiter,
        cache=cache,
        settings=settings,
    )


@router.post("/file_parse")
async def parse_file(
    request: Request,
    api_key: ApiKey | None = Depends(require_api_key),
    session: AsyncSession = Depends(get_session),
    upstream: UpstreamClient = Depends(_upstream),
    limiter=Depends(_limiter),
    settings: Settings = Depends(_settings),
):
    return await handle_file_parse(
        request=request,
        api_key=api_key,
        session=session,
        upstream=upstream,
        limiter=limiter,
        settings=settings,
    )
