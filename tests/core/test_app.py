"""create_app startup validation (workers guard, logging bootstrap).

Spec: mvp-implementation.md §7.1 (单 worker 约束), §3.6 (结构化日志).
"""

from __future__ import annotations

import json
import logging

import pytest

from mineru_gateway.main import create_app


def test_create_app_rejects_multiple_workers(settings, capsys):
    """§7.1: GATEWAY_WORKERS>1 must abort startup with a logged error.

    configure_logging() runs before the guard, so the failure is emitted
    through the configured handler: a json_logs deployment gets a JSON record
    on stderr instead of a bare last-resort line.
    """
    root = logging.getLogger()
    saved_handlers, saved_level = list(root.handlers), root.level
    try:
        with pytest.raises(SystemExit) as excinfo:
            create_app(
                settings=settings.model_copy(update={"workers": 2, "json_logs": True})
            )
        assert excinfo.value.code == 1
    finally:
        root.handlers = saved_handlers
        root.setLevel(saved_level)

    lines = [ln for ln in capsys.readouterr().err.splitlines() if ln.strip()]
    payload = json.loads(lines[-1])
    assert payload["level"] == "ERROR"
    assert "GATEWAY_WORKERS=2 is not supported" in payload["message"]
