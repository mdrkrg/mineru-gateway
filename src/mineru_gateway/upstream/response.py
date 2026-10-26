"""Helpers for relaying buffered upstream HTTP responses."""

from __future__ import annotations

import httpx
from starlette.responses import Response

_EXCLUDED_HEADERS = frozenset(
    {
        "content-length",
        "content-encoding",
        "transfer-encoding",
        "connection",
        "x-request-id",
    }
)


def relay_headers(response: httpx.Response) -> dict[str, str]:
    """Drop transport-specific headers before constructing a new response."""
    return {
        key: value
        for key, value in response.headers.items()
        if key.lower() not in _EXCLUDED_HEADERS
    }


def relay_response(response: httpx.Response) -> Response:
    """Relay a buffered upstream response with gateway-safe headers."""
    return Response(
        content=response.content,
        status_code=response.status_code,
        headers=relay_headers(response),
        media_type=response.headers.get("content-type"),
    )
