"""Validated wire-level schemas for MinerU 4.0 task responses."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, StrictStr, StringConstraints

from .params import MineruTier, OutputFormat

UpstreamTaskStatus = Literal[
    "queued",
    "running",
    "completed",
    "partial",
    "failed",
    "canceled",
]
GatewayTaskStatus = Literal[
    "pending",
    "processing",
    "completed",
    "partial",
    "failed",
    "cancelled",
]
TaskId = Annotated[StrictStr, StringConstraints(strip_whitespace=True, min_length=1)]

_GATEWAY_STATUS_BY_UPSTREAM: dict[UpstreamTaskStatus, GatewayTaskStatus] = {
    "queued": "pending",
    "running": "processing",
    "completed": "completed",
    "partial": "partial",
    "failed": "failed",
    "canceled": "cancelled",
}


class UpstreamTaskPayload(BaseModel):
    """Minimum fields every MinerU V1 task/status JSON response must contain."""

    model_config = ConfigDict(extra="allow", use_enum_values=True)

    task_id: TaskId
    status: UpstreamTaskStatus
    tier: MineruTier
    output_formats: list[OutputFormat]
    files: list[dict[str, Any]]


class UpstreamTaskReference(BaseModel):
    """Task identity carried by a non-JSON response's V1 response headers."""

    model_config = ConfigDict(use_enum_values=True)

    task_id: TaskId
    status: UpstreamTaskStatus
    tier: MineruTier | None = None


def gateway_task_status(status: UpstreamTaskStatus) -> GatewayTaskStatus:
    """Map MinerU's native task status onto the gateway's public vocabulary."""
    return _GATEWAY_STATUS_BY_UPSTREAM[status]


def validate_submission_payload(value: object) -> UpstreamTaskPayload:
    """Validate an async submission response, which must still be active."""
    payload = UpstreamTaskPayload.model_validate(value)
    if payload.status not in {"queued", "running"}:
        raise ValueError(f"unexpected status for an accepted task: {payload.status}")
    return payload


def task_reference_from_headers(headers: Any) -> UpstreamTaskReference:
    """Validate task metadata attached to a binary V1 result response."""
    return UpstreamTaskReference.model_validate(
        {
            "task_id": headers.get("x-mineru-task-id"),
            "status": headers.get("x-mineru-task-status"),
            "tier": headers.get("x-mineru-task-tier"),
        }
    )
