"""Unauthenticated gateway metadata: /v1/health and /v1/config."""

from __future__ import annotations

from fastapi import APIRouter, Request
from starlette.responses import JSONResponse

from ..upstream.client import UpstreamClient

router = APIRouter(prefix="/v1", tags=["health"])


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
        "features": up.features,
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


@router.get("/config")
async def config(request: Request) -> dict:
    """Capabilities the panel needs before it has any credential.

    The web UI cannot discover ``GATEWAY_USER_AUTH_ENABLED`` from a failed
    login, so key-only deployments get an explicit answer here instead of
    probing routes that are intentionally absent.
    """
    return {"user_auth_enabled": request.app.state.settings.user_auth_enabled}
