"""GET /health: aggregate gateway + upstream status."""

from __future__ import annotations

from fastapi import APIRouter, Request
from starlette.responses import JSONResponse

from ..upstream.client import UpstreamClient

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(request: Request):
    upstream: UpstreamClient = request.app.state.upstream
    try:
        up = await upstream.get_health()
    except Exception as exc:
        return JSONResponse(
            status_code=503,
            content={
                "gateway": "healthy",
                "status": "degraded",
                "upstream": {"status": "unreachable", "error": str(exc)},
            },
        )

    upstream_payload: dict = {
        "status": up.status,
        "version": up.version or None,
        "protocol_version": up.protocol_version,
        "max_concurrent_requests": up.max_concurrent,
        "queued_tasks": up.queued,
        "processing_tasks": up.processing,
        "completed_tasks": up.completed,
        "failed_tasks": up.failed,
        "processing_window_size": up.processing_window_size,
        "free_slots": up.free_slots,
    }
    gateway_status = "healthy" if up.status == "healthy" else "degraded"
    http_status = 200 if up.status == "healthy" else 503
    return JSONResponse(
        status_code=http_status,
        content={
            "gateway": "healthy",
            "status": gateway_status,
            "upstream": upstream_payload,
        },
    )
