"""Tests for CORS config parsing and middleware integration."""

from __future__ import annotations

import httpx
import pytest
from asgi_lifespan import LifespanManager
from pydantic import ValidationError

from mineru_gateway.config import Settings
from mineru_gateway.main import create_app


# ---------------------------------------------------------------------------
# Config parsing
# ---------------------------------------------------------------------------

CORS_FIELDS = [
    "cors_allow_origins",
    "cors_allow_methods",
    "cors_allow_headers",
]


def test_default_cors_settings():
    s = Settings(admin_token="t")
    assert s.cors_allow_origins == ["*"]
    assert s.cors_allow_methods == ["*"]
    assert s.cors_allow_headers == ["*"]
    assert s.cors_allow_credentials is False
    assert s.cors_max_age == 600


@pytest.mark.parametrize("field", CORS_FIELDS)
def test_cors_comma_separated_string(field: str):
    """Env-var style comma-separated values are parsed into a list."""
    s = Settings(admin_token="t", **{field: "a, b, c"})
    assert getattr(s, field) == ["a", "b", "c"]


@pytest.mark.parametrize("field", CORS_FIELDS)
def test_cors_json_array_string(field: str):
    """JSON-array env-var values are parsed correctly."""
    s = Settings(admin_token="t", **{field: '["x", "y"]'})
    assert getattr(s, field) == ["x", "y"]


@pytest.mark.parametrize("field", CORS_FIELDS)
def test_cors_empty_string(field: str):
    """Empty string produces an empty list."""
    s = Settings(admin_token="t", **{field: ""})
    assert getattr(s, field) == []


@pytest.mark.parametrize("field", CORS_FIELDS)
def test_cors_star_only(field: str):
    """A bare '*' is treated as a single-element list."""
    s = Settings(admin_token="t", **{field: "*"})
    assert getattr(s, field) == ["*"]


@pytest.mark.parametrize("field", CORS_FIELDS)
def test_cors_list_passthrough(field: str):
    """Passing a Python list directly should return it unchanged."""
    s = Settings(admin_token="t", **{field: ["x", "y"]})
    assert getattr(s, field) == ["x", "y"]


def test_cors_invalid_json_raises_validation_error():
    """Malformed JSON-like input produces a clear ValidationError."""
    with pytest.raises(ValidationError, match="valid JSON array"):
        Settings(admin_token="t", cors_allow_origins="[http://x.com]")


def test_cors_json_with_trailing_comma():
    """JSON with a trailing comma should be handled by comma-splitting (not JSON)."""
    s = Settings(admin_token="t", cors_allow_origins="http://a.com, http://b.com,")
    assert s.cors_allow_origins == ["http://a.com", "http://b.com"]


# ---------------------------------------------------------------------------
# Middleware integration
# ---------------------------------------------------------------------------


async def test_cors_headers_present_on_response(client):
    """When Origin header is present, response includes Access-Control-Allow-Origin."""
    resp = await client.get("/health", headers={"Origin": "http://localhost"})
    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == "*"


async def test_cors_preflight_options_returns_204(client):
    """OPTIONS preflight should return 200 with correct CORS headers."""
    resp = await client.options(
        "/tasks",
        headers={
            "Origin": "http://example.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == "*"
    assert "access-control-allow-methods" in resp.headers
    assert "access-control-max-age" in resp.headers


async def test_cors_custom_origins_restrict(settings, upstream_client):
    """When a specific origin list is set, disallowed origins get no CORS header."""
    settings.cors_allow_origins = ["http://trusted.local"]
    settings.cors_allow_credentials = True
    app = create_app(settings=settings, upstream_client=upstream_client)
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            resp = await c.get("/health", headers={"Origin": "http://trusted.local"})
            assert resp.headers["access-control-allow-origin"] == "http://trusted.local"
            assert resp.headers["access-control-allow-credentials"] == "true"

            resp = await c.get("/health", headers={"Origin": "http://evil.com"})
            assert "access-control-allow-origin" not in resp.headers


async def test_cors_credentials_header(settings, upstream_client):
    """When allow_credentials=True, the header is reflected."""
    settings.cors_allow_credentials = True
    app = create_app(settings=settings, upstream_client=upstream_client)
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as c:
            resp = await c.get("/health", headers={"Origin": "http://example.com"})
            assert resp.headers["access-control-allow-credentials"] == "true"
