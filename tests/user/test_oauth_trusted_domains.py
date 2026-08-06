"""Tests for OIDC trusted_email_domains (spec: Section 3.2, 4.5 step 3h, 9.7).

Spec: user-management-and-oauth.md
  Section 3.2 - OIDC provider config (trusted_email_domains field)
  Section 4.5 step 3h - trusted domain exception
  Section 7.2 - trusted_email_domains is a trust decision
  Section 9.7 - OAuth test points (trusted_email_domains)
"""

from __future__ import annotations

from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from asgi_lifespan import LifespanManager

from mineru_gateway.config import OIDCProviderConfig
from mineru_gateway.main import create_app


# ===== Fixtures =====


def _make_provider(**overrides) -> OIDCProviderConfig:
    base = {
        "name": "keycloak",
        "openid_configuration_endpoint": (
            "https://keycloak.example.com/.well-known/openid-configuration"
        ),
        "client_id": "test-client-id",
        "client_secret": "test-client-secret",
    }
    base.update(overrides)
    return OIDCProviderConfig(**base)


_TRUSTED_PROVIDER = _make_provider(trusted_email_domains=["Example.COM"])

_TRUSTED_WITH_FALLBACK_PROVIDER = _make_provider(
    email_fallback_domain="idp.example.com",
    trusted_email_domains=["idp.example.com"],
)


@pytest.fixture
def trusted_settings(settings):
    return settings.model_copy(
        update={
            "oidc_providers": [_TRUSTED_PROVIDER],
            "oauth_redirect_base_url": "http://testserver",
        }
    )


@pytest.fixture
def trusted_fallback_settings(settings):
    return settings.model_copy(
        update={
            "oidc_providers": [_TRUSTED_WITH_FALLBACK_PROVIDER],
            "oauth_redirect_base_url": "http://testserver",
        }
    )


@pytest.fixture
async def trusted_app(
    trusted_settings, upstream_client, monkeypatch, mock_oauth_client
):
    from mineru_gateway.auth.oauth import base

    monkeypatch.setattr(
        base,
        "get_oauth_client",
        lambda name: mock_oauth_client if name == "keycloak" else None,
    )
    application = create_app(settings=trusted_settings, upstream_client=upstream_client)
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def trusted_fallback_app(
    trusted_fallback_settings, upstream_client, monkeypatch, mock_oauth_client
):
    from mineru_gateway.auth.oauth import base

    monkeypatch.setattr(
        base,
        "get_oauth_client",
        lambda name: mock_oauth_client if name == "keycloak" else None,
    )
    application = create_app(
        settings=trusted_fallback_settings, upstream_client=upstream_client
    )
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def trusted_client(trusted_app):
    transport = httpx.ASGITransport(app=trusted_app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as c:
        yield c


@pytest.fixture
async def trusted_fallback_client(trusted_fallback_app):
    transport = httpx.ASGITransport(app=trusted_fallback_app)
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


async def _register_user(client, email: str) -> None:
    resp = await client.post(
        "/auth/register",
        json={"email": email, "password": "secret123", "display_name": "User"},
    )
    assert resp.status_code == 201, resp.text


# ===== Section 3.2: trusted_email_domains config field =====


async def test_trusted_email_domains_default_empty():
    """Section 9.7: trusted_email_domains defaults to an empty list."""
    cfg = _make_provider()
    assert cfg.trusted_email_domains == []


async def test_trusted_email_domains_parsed_from_config():
    """Section 3.2: trusted_email_domains is a settable string array."""
    cfg = _make_provider(trusted_email_domains=["idp.example.com", "Example.com"])
    assert cfg.trusted_email_domains == ["idp.example.com", "Example.com"]


# ===== Section 4.5 step 3h / 9.7: trusted domain exception =====


async def test_callback_claim_missing_trusted_domain_new_user_verified(
    trusted_client, mock_oauth_client
):
    """Section 9.7: email_verified claim missing + domain in
    trusted_email_domains -> new User is_verified=true."""
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "trusted-sub-1",
            "email": "trusted-user@example.com",
            "name": "Trusted User",
        }
    )

    resp = await _oauth_flow(trusted_client)
    assert resp.status_code == 200, resp.text

    token = resp.json()["access_token"]
    me = await trusted_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["email"] == "trusted-user@example.com"
    assert me.json()["is_verified"] is True


async def test_callback_claim_missing_trusted_domain_existing_user_linked(
    trusted_client, mock_oauth_client
):
    """Section 9.7: email_verified claim missing + domain in
    trusted_email_domains -> existing User is linked (no 400)."""
    await _register_user(trusted_client, "trusted-user@example.com")

    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "trusted-sub-2",
            "email": "trusted-user@example.com",
            "name": "Trusted User",
        }
    )

    resp = await _oauth_flow(trusted_client)
    assert resp.status_code == 200, resp.text


async def test_callback_claim_false_trusted_domain_existing_user_linked(
    trusted_client, mock_oauth_client
):
    """Section 9.7: email_verified=false + domain in trusted_email_domains
    -> existing User is linked (no 409)."""
    await _register_user(trusted_client, "trusted-user@example.com")

    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "trusted-sub-3",
            "email": "trusted-user@example.com",
            "name": "Trusted User",
            "email_verified": False,
        }
    )

    resp = await _oauth_flow(trusted_client)
    assert resp.status_code == 200, resp.text


async def test_callback_claim_false_untrusted_domain_still_409(
    trusted_client, mock_oauth_client
):
    """Section 9.7: email_verified=false + domain NOT in trusted list ->
    still 409 (trust exception does not apply)."""
    await _register_user(trusted_client, "untrusted@other.com")

    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "untrusted-sub-1",
            "email": "untrusted@other.com",
            "name": "Untrusted",
            "email_verified": False,
        }
    )

    resp = await _oauth_flow(trusted_client)
    assert resp.status_code == 409, resp.text


async def test_callback_claim_false_trusted_domain_new_user_verified(
    trusted_client, mock_oauth_client
):
    """Section 9.7: email_verified=false + domain in trusted_email_domains
    -> new User is_verified=true."""
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "trusted-sub-4",
            "email": "trusted-user@example.com",
            "name": "Trusted User",
            "email_verified": False,
        }
    )

    resp = await _oauth_flow(trusted_client)
    assert resp.status_code == 200, resp.text

    token = resp.json()["access_token"]
    me = await trusted_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["email"] == "trusted-user@example.com"
    assert me.json()["is_verified"] is True


async def test_callback_trusted_domain_match_case_insensitive(
    trusted_client, mock_oauth_client
):
    """Section 4.5 step 3h: domain matching is case-insensitive on both
    sides — the email domain is uppercase while the configured list uses
    mixed-case 'Example.COM'."""
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "trusted-sub-5",
            "email": "TrustedUser@EXAMPLE.com",
            "name": "Trusted User",
        }
    )

    resp = await _oauth_flow(trusted_client)
    assert resp.status_code == 200, resp.text

    token = resp.json()["access_token"]
    me = await trusted_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["is_verified"] is True


async def test_callback_fallback_synthetic_email_trusted_domain_verified(
    trusted_fallback_client, mock_oauth_client
):
    """Section 9.7: synthetic <sub>@<fallback_domain> email with the
    fallback domain listed in trusted_email_domains -> is_verified=true
    even when the email_verified claim is missing."""
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "synthetic-sub-1",
            "name": "Synthetic User",
        }
    )

    resp = await _oauth_flow(trusted_fallback_client)
    assert resp.status_code == 200, resp.text

    token = resp.json()["access_token"]
    me = await trusted_fallback_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["email"] == "synthetic-sub-1@idp.example.com"
    assert me.json()["is_verified"] is True
