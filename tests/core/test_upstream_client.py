"""Upstream HTTP client construction."""

from __future__ import annotations

import httpx
import pytest
from pydantic import ValidationError

from mineru_gateway.config import Settings
from mineru_gateway.upstream.client import (
    UpstreamClient,
    build_http_client,
    build_probe_timeout,
)


async def test_build_http_client_uses_configured_timeouts():
    settings = Settings(
        admin_token="test",
        upstream_url="http://upstream.test",
        upstream_timeout_read=42.0,
    )

    client = build_http_client(settings)
    try:
        assert str(client.base_url) == "http://upstream.test"
        assert client.timeout.read == 42.0
    finally:
        await client.aclose()


async def test_default_read_timeout_covers_sync_parses():
    """A sync parse sends no bytes until it finishes; 30s would time out."""
    settings = Settings(admin_token="test")
    client = build_http_client(settings)
    try:
        assert client.timeout.read > client.timeout.connect
        assert build_probe_timeout(settings).read <= client.timeout.read
    finally:
        await client.aclose()


async def test_probes_use_a_short_read_timeout():
    """Health/status calls must fail fast instead of inheriting the parse timeout."""
    settings = Settings(admin_token="test", upstream_url="http://upstream.test")
    probe_read = build_probe_timeout(settings).read
    seen: dict[str, float] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen[request.url.path] = request.extensions["timeout"]["read"]
        return httpx.Response(200, json={"status": "ok"})

    client = httpx.AsyncClient(
        base_url="http://upstream.test", transport=httpx.MockTransport(handler)
    )
    upstream = UpstreamClient(client, probe_timeout=build_probe_timeout(settings))
    try:
        await upstream.get_health()
        await upstream.get_task_status("t1")
    finally:
        await client.aclose()

    assert seen["/v1/health"] == probe_read
    assert seen["/v1/tasks/t1"] == probe_read
    assert probe_read < settings.upstream_timeout_read


async def test_default_probe_timeout_is_finite():
    """Direct construction must not leave probes without a timeout."""
    seen: dict[str, float] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen[request.url.path] = request.extensions["timeout"]["read"]
        return httpx.Response(200, json={"status": "ok"})

    client = httpx.AsyncClient(
        base_url="http://upstream.test",
        transport=httpx.MockTransport(handler),
        timeout=600.0,
    )
    upstream = UpstreamClient(client)
    try:
        await upstream.get_health()
        await upstream.get_task_status("t1")
    finally:
        await client.aclose()

    assert seen["/v1/health"] == 10.0
    assert seen["/v1/tasks/t1"] == 10.0


async def test_submit_uses_a_short_read_timeout():
    """`/tasks` queues and returns 202, so it must not inherit the parse timeout."""
    settings = Settings(
        admin_token="test",
        upstream_url="http://upstream.test",
        upstream_timeout_read=600.0,
    )
    seen: dict[str, float] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen[request.url.path] = request.extensions["timeout"]["read"]
        return httpx.Response(202, json={"task_id": "t1"})

    client = httpx.AsyncClient(
        base_url="http://upstream.test",
        transport=httpx.MockTransport(handler),
        timeout=settings.upstream_timeout_read,
    )
    upstream = UpstreamClient(client, probe_timeout=build_probe_timeout(settings))
    try:
        await upstream.submit_task({}, [])
        await upstream.parse_file({}, [])
    finally:
        await client.aclose()

    assert seen["/v1/tasks"] == 30.0
    assert seen["/v1/file_parse"] == 600.0


def test_upstream_timeouts_must_be_positive():
    with pytest.raises(ValidationError):
        Settings(admin_token="test", upstream_timeout_read=0)
