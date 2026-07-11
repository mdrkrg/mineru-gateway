"""Upstream health-aware submission gating (simple MVP version)."""

from __future__ import annotations

from fastapi import HTTPException

from .client import UpstreamClient, UpstreamHealth


async def check_free_slot(client: UpstreamClient) -> UpstreamHealth:
    """Raise 503 if the upstream has no free slot. Returns health otherwise."""
    try:
        health = await client.get_health()
    except Exception as exc:  # upstream unreachable
        raise HTTPException(
            status_code=503,
            detail="Upstream unavailable",
            headers={"Retry-After": "5"},
        ) from exc

    if health.free_slots <= 0:
        raise HTTPException(
            status_code=503,
            detail=(
                f"No free slots (max={health.max_concurrent}, "
                f"queued={health.queued}, processing={health.processing})"
            ),
            headers={"Retry-After": "5"},
        )
    return health
