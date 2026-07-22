"""Tests for OAuth / OIDC login flow.

Spec: user-management-and-oauth.md
  Section 4.5 - OAuth endpoints (authorize, callback)
  Section 9.7 - OAuth test points
  Section 7.2 - CSRF protection, email association policy
"""

from __future__ import annotations

from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from asgi_lifespan import LifespanManager

from mineru_gateway.config import OIDCProviderConfig
from mineru_gateway.main import create_app

TEST_OIDC_PROVIDER = OIDCProviderConfig(
    name="keycloak",
    openid_configuration_endpoint="https://keycloak.example.com/.well-known/openid-configuration",
    client_id="test-client-id",
    client_secret="test-client-secret",
)


# ===== Fixtures =====


@pytest.fixture
def oauth_settings(settings):
    return settings.model_copy(
        update={
            "oidc_providers": [TEST_OIDC_PROVIDER],
            "oauth_redirect_base_url": "http://testserver",
        }
    )


@pytest.fixture
async def oauth_app(oauth_settings, upstream_client, monkeypatch, mock_oauth_client):
    from mineru_gateway.auth.oauth import base

    monkeypatch.setattr(
        base,
        "get_oauth_client",
        lambda name: mock_oauth_client if name == "keycloak" else None,
    )
    application = create_app(settings=oauth_settings, upstream_client=upstream_client)
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def oauth_client(oauth_app):
    transport = httpx.ASGITransport(app=oauth_app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as c:
        yield c


@pytest.fixture
def frontend_redirect_settings(oauth_settings):
    return oauth_settings.model_copy(
        update={"oauth_frontend_redirect_url": "https://app.example.com/auth/callback"}
    )


@pytest.fixture
async def frontend_redirect_app(
    frontend_redirect_settings, upstream_client, monkeypatch, mock_oauth_client
):
    from mineru_gateway.auth.oauth import base

    monkeypatch.setattr(
        base,
        "get_oauth_client",
        lambda name: mock_oauth_client if name == "keycloak" else None,
    )
    application = create_app(
        settings=frontend_redirect_settings, upstream_client=upstream_client
    )
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def frontend_redirect_client(frontend_redirect_app):
    transport = httpx.ASGITransport(app=frontend_redirect_app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as c:
        yield c


# ===== Helper =====


async def _oauth_flow(client, code="test-code"):
    """Helper: call authorize, extract state, call callback.

    Returns the callback response. Section 4.5 flow.
    """
    auth_resp = await client.get("/auth/oauth/keycloak/authorize")
    assert auth_resp.status_code == 302, auth_resp.text

    location = auth_resp.headers.get("location", "")
    params = parse_qs(urlparse(location).query)
    state = params.get("state", [""])[0]

    cb_resp = await client.get(
        f"/auth/oauth/keycloak/callback?code={code}&state={state}"
    )
    return cb_resp


# ===== Section 4.5 / 9.7: Authorize endpoint =====


async def test_authorize_returns_302_and_sets_csrf_cookie(oauth_client):
    """Section 9.7: GET /auth/oauth/{provider}/authorize -> 302 + CSRF cookie."""
    resp = await oauth_client.get("/auth/oauth/keycloak/authorize")
    assert resp.status_code == 302
    assert "location" in resp.headers
    set_cookie = resp.headers.get("set-cookie", "")
    assert set_cookie


async def test_authorize_nonexistent_provider_returns_404(oauth_client):
    """Section 9.7 / 4.5: GET /auth/oauth/{unknown}/authorize -> 404."""
    resp = await oauth_client.get("/auth/oauth/nonexistent/authorize")
    assert resp.status_code == 404


# ===== Section 4.5 / 9.7: Callback - success cases =====


async def test_callback_first_login_creates_user_and_oauth_account(
    oauth_client, mock_oauth_client
):
    """Section 9.7: first login -> creates new User + OAuthAccount -> token pair."""
    resp = await _oauth_flow(oauth_client)
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["token_type"] == "bearer"


async def test_callback_existing_oauth_account_updates_tokens(
    oauth_client, mock_oauth_client
):
    """Section 9.7: existing OAuthAccount -> updates tokens -> token pair."""
    first = await _oauth_flow(oauth_client)
    assert first.status_code == 200

    second = await _oauth_flow(oauth_client)
    assert second.status_code == 200
    assert second.json()["access_token"]


async def test_callback_existing_oauth_account_ignores_email_verified_false(
    oauth_client, mock_oauth_client
):
    """Section 4.5: existing OAuthAccount (by sub) -> email_verified not checked.

    The email_verified check (409/400) only applies when linking by email
    (no existing OAuthAccount). Step 4 takes precedence over the email sub-check.
    """
    first = await _oauth_flow(oauth_client)
    assert first.status_code == 200

    # Second login with email_verified=false - should still work
    # because OAuthAccount already exists by (keycloak, oidc-sub-123)
    mock_oauth_client.get_profile.return_value = {
        "sub": "oidc-sub-123",
        "email": "oauth-user@example.com",
        "name": "OAuth User",
        "email_verified": False,
    }

    second = await _oauth_flow(oauth_client)
    assert second.status_code == 200
    assert second.json()["access_token"]

    # is_verified should NOT be downgraded (first login set it via email_verified=true,
    # and existing OAuthAccount relogin does not touch is_verified per Section 4.5 step 4)
    token = second.json()["access_token"]
    me = await oauth_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["is_verified"] is True


async def test_callback_email_exists_email_verified_true_links_to_existing_user(
    oauth_client, mock_oauth_client
):
    """Section 9.7: email exists & email_verified=true -> links to existing User."""
    reg = await oauth_client.post(
        "/auth/register",
        json={
            "email": "oauth-user@example.com",
            "password": "secret123",
            "display_name": "PreRegistered",
        },
    )
    assert reg.status_code == 201

    resp = await _oauth_flow(oauth_client)
    assert resp.status_code == 200
    assert resp.json()["access_token"]


# ===== Section 4.5 / 9.7: Callback - error cases =====


async def test_callback_state_mismatch_returns_400(oauth_client):
    """Section 9.7: state mismatch -> 400 (CSRF attack or expired cookie)."""
    resp = await oauth_client.get(
        "/auth/oauth/keycloak/callback?code=test-code&state=fake-state"
    )
    assert resp.status_code == 400


async def test_callback_code_exchange_failure_returns_400(
    oauth_client, mock_oauth_client
):
    """Section 9.7: code exchange fails (OIDC provider rejects) -> 400."""
    mock_oauth_client.get_access_token = AsyncMock(
        side_effect=Exception("OIDC provider rejected code")
    )

    resp = await _oauth_flow(oauth_client)
    assert resp.status_code == 400


async def test_callback_email_exists_email_verified_false_returns_409(
    oauth_client, mock_oauth_client
):
    """Section 9.7: email exists & email_verified=false -> 409."""
    reg = await oauth_client.post(
        "/auth/register",
        json={
            "email": "oauth-user@example.com",
            "password": "secret123",
        },
    )
    assert reg.status_code == 201

    mock_oauth_client.get_profile.return_value = {
        "sub": "oidc-sub-123",
        "email": "oauth-user@example.com",
        "name": "OAuth User",
        "email_verified": False,
    }

    resp = await _oauth_flow(oauth_client)
    assert resp.status_code == 409


async def test_callback_email_exists_email_verified_missing_returns_400(
    oauth_client, mock_oauth_client
):
    """Section 9.7: email exists & email_verified missing -> 400."""
    reg = await oauth_client.post(
        "/auth/register",
        json={
            "email": "oauth-user@example.com",
            "password": "secret123",
        },
    )
    assert reg.status_code == 201

    mock_oauth_client.get_profile.return_value = {
        "sub": "oidc-sub-123",
        "email": "oauth-user@example.com",
        "name": "OAuth User",
    }

    resp = await _oauth_flow(oauth_client)
    assert resp.status_code == 400


# ===== Section 4.5 / 9.7: Callback - display_name fallback chain =====


async def test_callback_display_name_from_name(oauth_client, mock_oauth_client):
    """Section 9.7: display_name from userinfo 'name' (highest priority)."""
    mock_oauth_client.get_profile.return_value = {
        "sub": "oidc-sub-name",
        "email": "name-user@example.com",
        "name": "FullName User",
        "preferred_username": "prefuser",
        "given_name": "GivenName",
        "email_verified": True,
    }

    resp = await _oauth_flow(oauth_client)
    assert resp.status_code == 200

    token = resp.json()["access_token"]
    me = await oauth_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["display_name"] == "FullName User"


async def test_callback_display_name_empty_name_falls_back(
    oauth_client, mock_oauth_client
):
    """Section 4.5: name is empty string -> fallback to preferred_username.

    Spec says "first non-empty value" - empty string should not be used.
    """
    mock_oauth_client.get_profile.return_value = {
        "sub": "oidc-sub-empty-name",
        "email": "empty-name@example.com",
        "name": "",
        "preferred_username": "fallback-user",
        "given_name": "GivenName",
        "email_verified": True,
    }

    resp = await _oauth_flow(oauth_client)
    assert resp.status_code == 200

    token = resp.json()["access_token"]
    me = await oauth_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["display_name"] == "fallback-user"


async def test_callback_display_name_fallback_to_preferred_username(
    oauth_client, mock_oauth_client
):
    """Section 9.7: name missing -> fallback to preferred_username."""
    mock_oauth_client.get_profile.return_value = {
        "sub": "oidc-sub-pref",
        "email": "pref-user@example.com",
        "preferred_username": "pref-username",
        "given_name": "GivenName",
        "email_verified": True,
    }

    resp = await _oauth_flow(oauth_client)
    assert resp.status_code == 200

    token = resp.json()["access_token"]
    me = await oauth_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["display_name"] == "pref-username"


async def test_callback_display_name_fallback_to_given_name(
    oauth_client, mock_oauth_client
):
    """Section 9.7: name + preferred_username missing -> fallback to given_name."""
    mock_oauth_client.get_profile.return_value = {
        "sub": "oidc-sub-given",
        "email": "given-user@example.com",
        "given_name": "GivenOnly",
        "email_verified": True,
    }

    resp = await _oauth_flow(oauth_client)
    assert resp.status_code == 200

    token = resp.json()["access_token"]
    me = await oauth_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["display_name"] == "GivenOnly"


async def test_callback_display_name_fallback_to_email_local_part(
    oauth_client, mock_oauth_client
):
    """Section 9.7: all name fields missing -> fallback to email local part."""
    mock_oauth_client.get_profile.return_value = {
        "sub": "oidc-sub-email",
        "email": "localpart@example.com",
        "email_verified": True,
    }

    resp = await _oauth_flow(oauth_client)
    assert resp.status_code == 200

    token = resp.json()["access_token"]
    me = await oauth_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["display_name"] == "localpart"


# ===== Section 4.5 / 9.7: is_verified behavior =====


async def test_callback_new_user_is_verified_true(oauth_client, mock_oauth_client):
    """Section 9.7: email_verified=true -> new User is_verified=true."""
    mock_oauth_client.get_profile.return_value = {
        "sub": "verified-sub",
        "email": "verified@example.com",
        "name": "Verified User",
        "email_verified": True,
    }

    resp = await _oauth_flow(oauth_client)
    assert resp.status_code == 200

    token = resp.json()["access_token"]
    me = await oauth_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["is_verified"] is True


async def test_callback_existing_user_is_verified_not_upgraded(
    oauth_client, mock_oauth_client
):
    """Section 9.7: existing User is_verified not upgraded by OAuth login."""
    reg = await oauth_client.post(
        "/auth/register",
        json={
            "email": "oauth-user@example.com",
            "password": "secret123",
        },
    )
    assert reg.status_code == 201

    mock_oauth_client.get_profile.return_value = {
        "sub": "oidc-sub-123",
        "email": "oauth-user@example.com",
        "name": "OAuth User",
        "email_verified": True,
    }

    resp = await _oauth_flow(oauth_client)
    assert resp.status_code == 200

    token = resp.json()["access_token"]
    me = await oauth_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["is_verified"] is False


# ===== Section 4.5 / 9.7: Callback token works =====


async def test_callback_access_token_works_for_users_me(
    oauth_client, mock_oauth_client
):
    """Section 9.7: access_token from callback can call /users/me."""
    resp = await _oauth_flow(oauth_client)
    assert resp.status_code == 200

    token = resp.json()["access_token"]
    me = await oauth_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.status_code == 200
    assert me.json()["email"] == "oauth-user@example.com"


# ===== Section 4.5: Frontend redirect =====


async def test_callback_frontend_redirect_returns_302_with_fragment(
    frontend_redirect_client, mock_oauth_client
):
    """Section 4.5: oauth_frontend_redirect_url set -> 302 with URI fragment."""
    resp = await _oauth_flow(frontend_redirect_client)
    assert resp.status_code == 302

    location = resp.headers.get("location", "")
    assert location.startswith("https://app.example.com/auth/callback#")
    assert "access_token=" in location
    assert "refresh_token=" in location
    assert "token_type=bearer" in location
