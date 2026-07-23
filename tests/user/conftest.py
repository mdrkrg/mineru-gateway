"""User management & OAuth test fixtures (Section 4)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from asgi_lifespan import LifespanManager

from mineru_gateway.config import Settings
from mineru_gateway.main import create_app


@pytest.fixture
def settings_no_user_auth(settings) -> Settings:
    """Section 6.3: USER_AUTH_ENABLED=false."""
    return settings.model_copy(update={"user_auth_enabled": False})


@pytest.fixture
def settings_closed_registration(settings) -> Settings:
    """Section 4.2: OPEN_REGISTRATION=false."""
    return settings.model_copy(update={"open_registration": False})


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
    """Mock OIDC client for OAuth tests (Section 5.2 OAuthClient contract).

    get_authorization_url dynamically includes state so tests can extract it
    from the redirect Location header.
    """

    async def _get_authorization_url(redirect_uri, state=None, **kwargs):
        url = "https://oidc.example.com/authorize"
        if state:
            url += f"?state={state}"
        if redirect_uri:
            url += f"&redirect_uri={redirect_uri}"
        return url

    client = MagicMock()
    client.get_authorization_url = AsyncMock(side_effect=_get_authorization_url)
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
