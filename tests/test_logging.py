"""Tests for Phase 4 structured JSON logging.

Spec: mvp-implementation.md §3.6 (结构化日志: JSON, 含 task_id / api_key_id /
duration_ms 等字段).
Plan: Phase 4 — "结构化日志".
"""

from __future__ import annotations

import json
import logging

from mineru_gateway.logging_config import JsonFormatter, configure_logging


def test_json_formatter_emits_valid_json():
    """§3.6: 日志记录被格式化为合法 JSON, 含标准字段."""
    formatter = JsonFormatter()
    record = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="hello %s",
        args=("world",),
        exc_info=None,
    )
    payload = json.loads(formatter.format(record))
    assert payload["level"] == "INFO"
    assert payload["logger"] == "test"
    assert payload["message"] == "hello world"
    assert "timestamp" in payload


def test_json_formatter_includes_extra_context():
    """§3.6: 附加上下文字段 (task_id / api_key_id / duration_ms) 进入 JSON."""
    formatter = JsonFormatter()
    record = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="done",
        args=(),
        exc_info=None,
    )
    record.task_id = "t-1"
    record.api_key_id = "k-1"
    record.duration_ms = 12.5
    payload = json.loads(formatter.format(record))
    assert payload["task_id"] == "t-1"
    assert payload["api_key_id"] == "k-1"
    assert payload["duration_ms"] == 12.5


def test_json_formatter_serializes_exception():
    """§3.6: 异常信息被写入 JSON 的 exc_info 字段而非破坏 JSON 结构."""
    formatter = JsonFormatter()
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = logging.LogRecord(
            name="test",
            level=logging.ERROR,
            pathname=__file__,
            lineno=1,
            msg="failed",
            args=(),
            exc_info=sys.exc_info(),
        )
    payload = json.loads(formatter.format(record))
    assert "ValueError: boom" in payload["exc_info"]


def test_configure_logging_installs_json_handler():
    """§3.6: configure_logging(json_logs=True) 安装 JSON 格式化的 handler."""
    configure_logging(level="INFO", json_logs=True)
    root = logging.getLogger()
    assert root.handlers
    assert any(isinstance(h.formatter, JsonFormatter) for h in root.handlers)
