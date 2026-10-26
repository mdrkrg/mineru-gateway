"""create_app startup validation (workers guard, logging bootstrap).

Spec: mvp-implementation.md §7.1 (单 worker 约束), §3.6 (结构化日志).
"""

from __future__ import annotations

import json
import logging

import httpx
import pytest
from asgi_lifespan import LifespanManager
from pydantic import ValidationError

from mineru_gateway.config import Settings
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


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("", ""),
        ("/", ""),
        ("/mineru/api", "/mineru/api"),
        (" /mineru//api/ ", "/mineru/api"),
    ],
)
def test_settings_normalizes_root_path(value, expected):
    assert Settings(admin_token="test", root_path=value).root_path == expected


@pytest.mark.parametrize(
    "value",
    [
        "mineru/api",
        "https://example.com/mineru/api",
        "//example.com/mineru/api",
        "/mineru/../api",
        "/mineru/api?version=1",
        "/mineru/api#docs",
        "/mineru\\api",
    ],
)
def test_settings_rejects_invalid_root_path(value):
    with pytest.raises(ValidationError):
        Settings(admin_token="test", root_path=value)


async def test_root_path_preserves_routes_and_prefixes_openapi(
    settings, upstream_client
):
    application = create_app(
        settings=settings.model_copy(update={"root_path": "/mineru/api"}),
        upstream_client=upstream_client,
    )

    async with LifespanManager(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            health = await client.get("/v1/health")
            docs = await client.get("/docs")

    assert health.status_code == 200
    assert docs.status_code == 200
    assert "'/mineru/api/openapi.json'" in docs.text
