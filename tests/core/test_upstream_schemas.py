"""Validation of the minimum MinerU 4.0 task response contract."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from mineru_gateway.upstream.schemas import UpstreamTaskPayload


def _payload(**overrides):
    payload = {
        "task_id": "job_123",
        "status": "queued",
        "tier": "standard",
        "output_formats": ["markdown"],
        "files": [],
    }
    payload.update(overrides)
    return payload


@pytest.mark.parametrize("task_id", [None, "", "   ", 123])
def test_task_id_must_be_a_non_empty_string(task_id):
    with pytest.raises(ValidationError):
        UpstreamTaskPayload.model_validate(_payload(task_id=task_id))


def test_unknown_task_status_is_rejected():
    with pytest.raises(ValidationError):
        UpstreamTaskPayload.model_validate(_payload(status="processing"))
