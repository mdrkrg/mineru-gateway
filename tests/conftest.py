"""Shared pytest fixtures: gateway app, mock upstream, DB, admin token, api key."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from asgi_lifespan import LifespanManager

from mineru_gateway.config import Settings
from mineru_gateway.main import create_app

from .mock_upstream import create_mock_upstream, state as mock_state

ADMIN_TOKEN = "test-admin-token"
TEST_JWT_SECRET = "test-jwt-secret-at-least-32-characters"


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
    )


@pytest.fixture
def settings_no_user_auth(settings) -> Settings:
    """Section 6.3: USER_AUTH_ENABLED=false."""
    return settings.model_copy(update={"user_auth_enabled": False})


@pytest.fixture
def settings_closed_registration(settings) -> Settings:
    """Section 4.2: OPEN_REGISTRATION=false."""
    return settings.model_copy(update={"open_registration": False})


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
async def no_auth_app(settings_no_user_auth, upstream_client):
    """Section 6.3: app with user_auth_enabled=false."""
    application = create_app(
        settings=settings_no_user_auth, upstream_client=upstream_client
    )
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def no_auth_client(no_auth_app):
    transport = httpx.ASGITransport(app=no_auth_app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as c:
        yield c


@pytest.fixture
async def closed_reg_app(settings_closed_registration, upstream_client):
    """Section 4.2: app with open_registration=false."""
    application = create_app(
        settings=settings_closed_registration, upstream_client=upstream_client
    )
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def closed_reg_client(closed_reg_app):
    transport = httpx.ASGITransport(app=closed_reg_app)
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


# ===== User auth fixtures (Section 4) =====


@pytest.fixture
async def registered_user(client) -> dict:
    """Register a user via POST /auth/register. Returns {email, password, display_name}."""
    email = "alice@example.com"
    password = "secret123"
    resp = await client.post(
        "/auth/register",
        json={
            "email": email,
            "password": password,
            "display_name": "Alice",
        },
    )
    assert resp.status_code == 201, resp.text
    return {"email": email, "password": password, "display_name": "Alice"}


@pytest.fixture
async def user_token(client, registered_user) -> str:
    """Login and return access_token."""
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


@pytest.fixture
def mock_oauth_client():
    """Mock OIDC client for OAuth tests (Section 5.2 OAuthClient contract)."""
    client = MagicMock()
    client.get_authorization_url = AsyncMock(
        return_value="https://oidc.example.com/authorize"
    )
    client.get_access_token = AsyncMock(
        return_value={"access_token": "oidc-access-token", "token_type": "bearer"}
    )
    client.get_profile = AsyncMock(
        return_value={
            "sub": "oidc-sub-123",
            "email": "oauth-user@example.com",
            "name": "OAuth User",
            "preferred_username": "oauthuser",
            "given_name": "OAuth",
            "email_verified": True,
        }
    )
    return client
