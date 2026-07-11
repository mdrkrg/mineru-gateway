"""GET /health: aggregate gateway + upstream status."""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..upstream.client import UpstreamClient

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(request: Request) -> dict:
    upstream: UpstreamClient = request.app.state.upstream
    result: dict = {"gateway": "healthy", "upstream": None}
    try:
        up = await upstream.get_health()
        result["upstream"] = {
            "status": up.status,
            "max_concurrent": up.max_concurrent,
            "queued": up.queued,
            "processing": up.processing,
            "free_slots": up.free_slots,
        }
    except Exception as exc:
        result["status"] = "degraded"
        result["upstream"] = {"status": "unreachable", "error": str(exc)}
        return result

    result["status"] = "healthy" if up.status == "healthy" else "degraded"
    return result
