"""Shared pytest fixtures: gateway app, mock upstream, DB, admin token, api key."""

from __future__ import annotations

import os

import httpx
import pytest
from asgi_lifespan import LifespanManager

from mineru_gateway.config import Settings
from mineru_gateway.main import create_app

from .mock_upstream import create_mock_upstream, state as mock_state

ADMIN_TOKEN = "test-admin-token"
TEST_JWT_SECRET = "test-jwt-secret-at-least-32-characters"

# Test-process isolation: Settings must never pick up a local .env file
# (config comes from explicit fixture kwargs only). Ambient GATEWAY_* env
# vars are stripped by the autouse fixture below; the e2e subprocess
# gateway applies the same scrub in tests/e2e/conftest.py.
Settings.model_config["env_file"] = None


@pytest.fixture(autouse=True)
def _isolate_gateway_env(monkeypatch):
    for key in [k for k in os.environ if k.startswith("GATEWAY_")]:
        monkeypatch.delenv(key)


@pytest.fixture(autouse=True)
def _reset_mock_state():
    mock_state.reset()
    yield
    mock_state.reset()


@pytest.fixture
def settings(tmp_path) -> Settings:
    db_file = tmp_path / "test.db"
    return Settings(
        upstream_url="http://mock-upstream",
        database_url=f"sqlite+aiosqlite:///{db_file}",
        admin_token=ADMIN_TOKEN,
        allow_anonymous=False,
        gateway_url="http://testserver",
        rate_limit_per_key=10,
        max_upload_size=1024,
        file_cache_dir=str(tmp_path / "cache"),
        enable_background=False,
        json_logs=False,
        create_tables=True,
        # Section 3.1: user auth enabled by default for tests
        user_auth_enabled=True,
        jwt_secret=TEST_JWT_SECRET,
        jwt_access_lifetime_seconds=900,
        jwt_refresh_lifetime_seconds=604800,
        open_registration=True,
        # Allow explicitly for existing tests, gate tests pin their own settings
        allow_unverified_accounts=True,
    )


@pytest.fixture
def upstream_client() -> httpx.AsyncClient:
    """httpx client backed by the mock upstream ASGI app."""
    transport = httpx.ASGITransport(app=create_mock_upstream())
    return httpx.AsyncClient(transport=transport, base_url="http://mock-upstream")


@pytest.fixture
async def app(settings, upstream_client):
    application = create_app(settings=settings, upstream_client=upstream_client)
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as c:
        yield c


@pytest.fixture
def admin_headers() -> dict:
    return {"X-Admin-Token": ADMIN_TOKEN}


@pytest.fixture
async def api_key(client, admin_headers) -> str:
    resp = await client.post(
        "/auth/keys", json={"label": "test"}, headers=admin_headers
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["api_key"]


@pytest.fixture
def sample_files() -> list[tuple[str, tuple[str, bytes, str]]]:
    return [("files", ("doc.pdf", b"%PDF-1.4 fake pdf bytes", "application/pdf"))]


# ===== User auth fixtures (needed for same-user key isolation tests) =====


@pytest.fixture
async def registered_user(client) -> dict:
    resp = await client.post(
        "/auth/register",
        json={
            "email": "stats-user@example.com",
            "password": "Str0ng!Pass",
            "display_name": "Stats User",
        },
    )
    assert resp.status_code == 201, resp.text
    return {
        "email": "stats-user@example.com",
        "password": "Str0ng!Pass",
        "display_name": "Stats User",
    }


@pytest.fixture
async def user_token(client, registered_user) -> str:
    resp = await client.post(
        "/auth/jwt/login",
        json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


@pytest.fixture
def user_headers(user_token) -> dict:
    return {"Authorization": f"Bearer {user_token}"}
