"""Shared MinerU 4.0 V1 payload and status semantics for test doubles.

The in-process, subprocess, and performance mocks keep their own runtime and
control behavior. This module only centralizes wire-level payload shapes and
status normalization so those mocks do not drift from one another.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

V1_TASK_STATUSES = frozenset(
    {"queued", "running", "completed", "partial", "failed", "canceled"}
)


def default_features() -> dict[str, Any]:
    return {
        "webhook": False,
        "output_formats": ["markdown", "middle_json", "structured_content", "zip"],
        "sources": ["file_id", "url", "inline"],
    }


def normalize_task_status(status: str) -> str:
    if status not in V1_TASK_STATUSES:
        raise ValueError(f"unsupported mock V1 task status: {status}")
    return status


def health_payload(
    *, healthy: bool, version: str = "4.0.12", features: dict | None = None
) -> dict[str, Any]:
    return {
        "status": "ok" if healthy else "degraded",
        "version": version,
        "features": features if features is not None else default_features(),
    }


def error_payload(
    message: str,
    *,
    code: str = "invalid_request",
    param: str | None = None,
) -> dict[str, Any]:
    return {
        "error": {
            "type": "invalid_request_error",
            "code": code,
            "message": message,
            "param": param,
        }
    }


def _output_formats(value: str | Sequence[str] | None) -> list[str]:
    if value is None:
        return ["markdown"]
    if isinstance(value, str):
        return [value]
    return list(value)


def _file_status(task_status: str, error: dict | None) -> str:
    if task_status == "partial":
        return "failed" if error else "completed"
    return task_status


def job_payload(
    task_id: str,
    *,
    status: str,
    file_names: list[str],
    tier: str = "standard",
    output_formats: str | Sequence[str] | None = None,
    error: dict | None = None,
) -> dict[str, Any]:
    status = normalize_task_status(status)
    file_status = _file_status(status, error)
    completed = len(file_names) if file_status == "completed" else 0
    failed = len(file_names) if file_status == "failed" else 0
    base = f"/v1/tasks/{task_id}"
    return {
        "task_id": task_id,
        "status": status,
        "created_at": "2026-01-01T00:00:00Z",
        "started_at": None,
        "finished_at": None,
        "tier": tier,
        "output_formats": _output_formats(output_formats),
        "access_level": "registered",
        "progress": {
            "completed": completed,
            "failed": failed,
            "total": len(file_names),
        },
        "files": [
            {
                "file_id": f"file-{index}",
                "name": name,
                "page_range": "",
                "status": file_status,
                "parse": None,
                "output_files": None,
                "error": error,
            }
            for index, name in enumerate(file_names)
        ],
        "links": {"self": base, "cancel": base},
        "status_url": base,
        "result_url": f"{base}/result",
    }


def inline_result_payload(
    task_id: str,
    *,
    file_name: str = "doc.pdf",
    tier: str = "standard",
) -> dict[str, Any]:
    payload = job_payload(
        task_id,
        status="completed",
        file_names=[file_name],
        tier=tier,
        output_formats=["markdown"],
    )
    payload["files"][0].update(
        {
            "parse": {"model_used": "mock", "duration_ms": 1},
            "content": {"markdown": "# parsed"},
        }
    )
    return payload


def canceled_payload(task_id: str) -> dict[str, Any]:
    return {"task_id": task_id, "status": "canceled", "canceled_at": None}
