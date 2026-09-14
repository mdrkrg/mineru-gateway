"""User management & OAuth test fixtures (Section 4)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from asgi_lifespan import LifespanManager

from mineru_gateway.config import OIDCProviderConfig, Settings
from mineru_gateway.main import create_app

if TYPE_CHECKING:
    from httpx import AsyncClient, Response

OauthFlow = Callable[["AsyncClient"], Awaitable["Response"]]


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
    async with _build_app(settings_no_user_auth, upstream_client) as application:
        yield application


@pytest.fixture
async def no_auth_client(no_auth_app):
    async with _client_for(no_auth_app) as c:
        yield c


@pytest.fixture
async def closed_reg_app(settings_closed_registration, upstream_client):
    """Section 4.2: app with open_registration=false."""
    async with _build_app(settings_closed_registration, upstream_client) as application:
        yield application


@pytest.fixture
async def closed_reg_client(closed_reg_app):
    async with _client_for(closed_reg_app) as c:
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


@pytest.fixture
def oauth_flow() -> OauthFlow:
    """Run the mock keycloak authorize + callback dance against a client.

    Returns a coroutine ``oauth_flow(client)`` that drives
    ``/auth/oauth/keycloak/authorize`` and returns the callback response.
    """

    async def _flow(client: AsyncClient) -> Response:
        auth_resp = await client.get("/auth/oauth/keycloak/authorize")
        assert auth_resp.status_code == 302, auth_resp.text
        location = auth_resp.headers.get("location", "")
        state = parse_qs(urlparse(location).query).get("state", [""])[0]
        return await client.get(
            f"/auth/oauth/keycloak/callback?code=test-code&state={state}"
        )

    return _flow


# ===== Email verification fixtures (spec: email-verification.md) =====
#
# The SMTP layer is replaced by EmailSenderStub (spec Section 5.2). The
# implementation must resolve send_verification_email through the module
# attribute (mineru_gateway.email.service.send_verification_email) at call
# time so monkeypatching intercepts it.

_EMAIL_VERIFY_OIDC_PROVIDER = OIDCProviderConfig(
    name="keycloak",
    openid_configuration_endpoint=(
        "https://keycloak.example.com/.well-known/openid-configuration"
    ),
    client_id="test-client-id",
    client_secret="test-client-secret",
)


class EmailSenderStub:
    """Test double for email.service.send_verification_email (spec Section 5.2).

    Records one entry per call. __call__ is synchronous and returns an
    already-completed awaitable, so implementations may either call or
    await the function. Set raise_error to simulate a send failure
    (spec Section 4.4: failures are logged and must not break the flow).
    """

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.raise_error: Exception | None = None

    def __call__(
        self,
        user_email: str,
        token: str,
        settings,
        *,
        locale: str | None = None,
    ) -> Awaitable[None]:
        if self.raise_error is not None:
            raise self.raise_error
        self.sent.append(
            {
                "user_email": user_email,
                "token": token,
                "settings": settings,
                "locale": locale,
            }
        )
        return _completed()

    def last(self) -> dict | None:
        return self.sent[-1] if self.sent else None

    def reset(self) -> None:
        self.sent.clear()


def _completed() -> Awaitable[None]:
    """Return an already-completed awaitable for EmailSenderStub."""

    async def _noop() -> None:
        return None

    return _noop()


@pytest.fixture
def email_sender(monkeypatch) -> EmailSenderStub:
    """Replace email.service.send_verification_email (spec Section 5.2)."""
    stub = EmailSenderStub()
    monkeypatch.setattr("mineru_gateway.email.service.send_verification_email", stub)
    return stub


@pytest.fixture
def smtp_settings(settings) -> Settings:
    """Spec Section 3.1: SMTP fully configured."""
    return settings.model_copy(
        update={
            "smtp_host": "smtp.example.com",
            "smtp_port": 587,
            "smtp_username": "sender@example.com",
            "smtp_password": "smtp-secret",
            "smtp_from": "sender@example.com",
            "smtp_from_name": "mineru-gateway",
            "smtp_starttls": True,
            "smtp_ssl_tls": False,
            "smtp_timeout": 10,
            "verify_email_token_lifetime_seconds": 3600,
            "verify_email_base_url": "",
        }
    )


@pytest.fixture
def redirect_settings(smtp_settings) -> Settings:
    """Spec Section 4.3: oauth_frontend_redirect_url configured."""
    return smtp_settings.model_copy(
        update={"oauth_frontend_redirect_url": "https://frontend.example.com/callback"}
    )


@pytest.fixture
def redirect_query_settings(smtp_settings) -> Settings:
    """Spec Section 4.3: redirect URL that already contains a query string."""
    return smtp_settings.model_copy(
        update={
            "oauth_frontend_redirect_url": (
                "https://frontend.example.com/callback?from=email"
            )
        }
    )


@pytest.fixture
def gated_smtp_settings(smtp_settings) -> Settings:
    """Spec Section 8.6/8.7: SMTP configured + verification gate enabled."""
    return smtp_settings.model_copy(update={"allow_unverified_accounts": False})


@pytest.fixture
def smtp_oidc_settings(smtp_settings) -> Settings:
    """Spec Section 8.7: SMTP + OIDC provider without trusted domains."""
    return smtp_settings.model_copy(
        update={
            "oidc_providers": [_EMAIL_VERIFY_OIDC_PROVIDER],
            "oauth_redirect_base_url": "http://testserver",
        }
    )


@pytest.fixture
def gated_smtp_oidc_settings(smtp_oidc_settings) -> Settings:
    """Spec Section 8.7: SMTP + OIDC + verification gate enabled."""
    return smtp_oidc_settings.model_copy(update={"allow_unverified_accounts": False})


# ===== Helper context managers for DRY fixture creation =====


@asynccontextmanager
async def _build_app(settings, upstream_client):
    application = create_app(settings=settings, upstream_client=upstream_client)
    async with LifespanManager(application):
        yield application


@asynccontextmanager
async def _client_for(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as c:
        yield c


def _patch_oauth(monkeypatch, mock_oauth_client):
    from mineru_gateway.auth.oauth import base

    monkeypatch.setattr(
        base,
        "get_oauth_client",
        lambda name: mock_oauth_client if name == "keycloak" else None,
    )


@pytest.fixture
async def smtp_app(smtp_settings, upstream_client, email_sender):
    async with _build_app(smtp_settings, upstream_client) as app:
        yield app


@pytest.fixture
async def smtp_client(smtp_app):
    async with _client_for(smtp_app) as c:
        yield c


@pytest.fixture
async def redirect_app(redirect_settings, upstream_client, email_sender):
    async with _build_app(redirect_settings, upstream_client) as app:
        yield app


@pytest.fixture
async def redirect_client(redirect_app):
    async with _client_for(redirect_app) as c:
        yield c


@pytest.fixture
async def redirect_query_app(redirect_query_settings, upstream_client, email_sender):
    async with _build_app(redirect_query_settings, upstream_client) as app:
        yield app


@pytest.fixture
async def redirect_query_client(redirect_query_app):
    async with _client_for(redirect_query_app) as c:
        yield c


@pytest.fixture
async def gated_smtp_app(gated_smtp_settings, upstream_client, email_sender):
    async with _build_app(gated_smtp_settings, upstream_client) as app:
        yield app


@pytest.fixture
async def gated_smtp_client(gated_smtp_app):
    async with _client_for(gated_smtp_app) as c:
        yield c


@pytest.fixture
async def smtp_oidc_app(
    smtp_oidc_settings, upstream_client, monkeypatch, mock_oauth_client, email_sender
):
    _patch_oauth(monkeypatch, mock_oauth_client)
    async with _build_app(smtp_oidc_settings, upstream_client) as app:
        yield app


@pytest.fixture
async def smtp_oidc_client(smtp_oidc_app):
    async with _client_for(smtp_oidc_app) as c:
        yield c


@pytest.fixture
async def gated_smtp_oidc_app(
    gated_smtp_oidc_settings,
    upstream_client,
    monkeypatch,
    mock_oauth_client,
    email_sender,
):
    _patch_oauth(monkeypatch, mock_oauth_client)
    async with _build_app(gated_smtp_oidc_settings, upstream_client) as app:
        yield app


@pytest.fixture
async def gated_smtp_oidc_client(gated_smtp_oidc_app):
    async with _client_for(gated_smtp_oidc_app) as c:
        yield c
