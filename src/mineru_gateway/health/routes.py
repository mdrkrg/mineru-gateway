"""Unauthenticated gateway metadata: /v1/health and /v1/config."""

from __future__ import annotations

from fastapi import APIRouter, Request
from starlette.responses import JSONResponse

from ..schemas import GatewayConfig, OAuthProviderInfo
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


@router.get("/config", response_model=GatewayConfig)
async def config(request: Request) -> GatewayConfig:
    """Unauthenticated capabilities a client reads before it has a credential.

    Key-only deployments have no login routes, so a failed login cannot
    distinguish "logins are off" from a broken route. ``providers`` is empty
    while the login stack is off.
    """
    settings = request.app.state.settings
    return GatewayConfig(
        user_auth_enabled=settings.user_auth_enabled,
        providers=(
            [OAuthProviderInfo(name=p.name) for p in settings.oidc_providers]
            if settings.user_auth_enabled
            else []
        ),
    )
