"""Structured JSON logging (§3.6).

Emits one JSON object per log record with standard fields plus any extra
context attached via ``logger.info(..., extra={"task_id": ...})`` such as
``task_id``, ``api_key_id`` and ``duration_ms``.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

# LogRecord attributes present on every record; anything else is treated as
# caller-supplied extra context and included in the JSON output.
_STANDARD_ATTRS = set(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()
) | {"message", "asctime", "taskName"}

_CONTEXT_FIELDS = (
    "task_id",
    "api_key_id",
    "duration_ms",
    "request_id",
    "path",
    "method",
    "status_code",
)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "timestamp": datetime.fromtimestamp(
                record.created, tz=timezone.utc
            ).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Include well-known context fields when present.
        for field in _CONTEXT_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value

        # Include any other non-standard attributes (custom extras).
        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS and key not in payload:
                payload[key] = value

        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str)


def configure_logging(*, level: str = "INFO", json_logs: bool = True) -> None:
    root = logging.getLogger()
    root.setLevel(level.upper())

    # Replace existing handlers so repeated calls are idempotent.
    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler()
    if json_logs:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        )
    root.addHandler(handler)
