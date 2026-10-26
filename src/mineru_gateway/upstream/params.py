"""Validate gateway parse fields and build MinerU 4.0 V1 query params."""

from __future__ import annotations

from enum import StrEnum
from typing import Any


class MineruTier(StrEnum):
    FLASH = "flash"
    BASIC = "basic"
    STANDARD = "standard"
    ADVANCED = "advanced"


class OutputFormat(StrEnum):
    MARKDOWN = "markdown"
    MIDDLE_JSON = "middle_json"
    STRUCTURED_CONTENT = "structured_content"
    ZIP = "zip"


VALID_TIERS = frozenset(MineruTier)
VALID_OCR_MODES = frozenset({"auto", "txt", "ocr"})
VALID_OUTPUT_FORMATS = frozenset(OutputFormat)
VALID_RESPONSE_FORMATS = frozenset({"json", "zip"})
MAX_TASK_FILES = 100

_BASE_FIELDS = frozenset({"tier", "ocr_mode", "page_range", "output_formats"})
_SYNC_FIELDS = _BASE_FIELDS | {"response_format", "wait_timeout"}


def _output_formats(value: Any, *, include_zip: bool) -> list[str]:
    formats: list[str] = []
    if value:
        raw_values = value if isinstance(value, (list, tuple)) else [value]
        for raw in raw_values:
            for item in str(raw).split(","):
                name = item.strip()
                if name and name not in formats:
                    formats.append(name)
    else:
        formats.append("markdown")

    unknown = [name for name in formats if name not in VALID_OUTPUT_FORMATS]
    if unknown:
        raise ValueError("unsupported output_format: " + ", ".join(unknown))
    if include_zip and "zip" not in formats:
        formats.append("zip")
    return formats


def _wait_timeout(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("wait_timeout must be an integer between 1 and 3600")
    try:
        timeout = int(str(value).strip())
    except TypeError, ValueError:
        raise ValueError("wait_timeout must be an integer between 1 and 3600") from None
    if not 1 <= timeout <= 3600:
        raise ValueError("wait_timeout must be an integer between 1 and 3600")
    return timeout


def parse_v1_params(
    data: dict[str, Any], *, sync: bool, include_zip: bool = False
) -> dict[str, Any]:
    """Return validated MinerU 4.0 V1 query parameters."""
    allowed = _SYNC_FIELDS if sync else _BASE_FIELDS
    unknown = sorted(set(data) - allowed)
    if unknown:
        raise ValueError("unsupported parse option: " + ", ".join(unknown))

    tier = data.get("tier")
    if tier is not None:
        tier = str(tier).strip().lower()
        if tier not in VALID_TIERS:
            raise ValueError(f"unsupported tier: {tier}")

    ocr_mode = str(data.get("ocr_mode") or "auto").strip().lower()
    if ocr_mode not in VALID_OCR_MODES:
        raise ValueError(f"unsupported ocr_mode: {ocr_mode}")

    params: dict[str, Any] = {
        "ocr_mode": ocr_mode,
        "output_formats": _output_formats(
            data.get("output_formats"), include_zip=include_zip
        ),
    }
    if tier is not None:
        params["tier"] = tier

    page_range = data.get("page_range")
    if page_range is not None and str(page_range).strip():
        params["page_range"] = str(page_range).strip()

    if sync:
        response_format = data.get("response_format")
        if response_format is not None:
            response_format = str(response_format).strip().lower()
            if response_format not in VALID_RESPONSE_FORMATS:
                raise ValueError(f"unsupported response_format: {response_format}")
            params["response_format"] = response_format
        if "wait_timeout" in data:
            params["wait_timeout"] = _wait_timeout(data["wait_timeout"])

    return params
