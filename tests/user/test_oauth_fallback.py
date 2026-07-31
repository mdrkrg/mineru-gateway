"""Tests for OAuth callback claim fallback chain (Section 4.5 step 3, Section 9.7).

Spec: user-management-and-oauth.md
  Section 3.2 - OIDC provider config (user_info_mapping, email_fallback_domain)
  Section 4.5 step 3 - Claim fallback chain (id_token, userinfo, mapping)
  Section 9.7 - OAuth test points (id_token, email_fallback, mapping)
"""

from __future__ import annotations

import base64
import json
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from asgi_lifespan import LifespanManager

from mineru_gateway.main import create_app


def _make_id_token(payload: dict) -> str:
    """Build an unsigned JWT id_token with the given payload claims.

    No signature verification is performed (spec: Section 4.5 step 3a),
    so alg=none is acceptable for test purposes.
    """
    header = (
        base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode())
        .rstrip(b"=")
        .decode()
    )
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    return f"{header}.{body}."


# ===== Fixtures =====


@pytest.fixture
def fallback_settings(settings):
    """Base settings for fallback tests with user_info_mapping and
    email_fallback_domain configured."""
    return settings.model_copy(
        update={
            "oidc_providers": [
                {
                    "name": "keycloak",
                    "openid_configuration_endpoint": "https://keycloak.example.com/.well-known/openid-configuration",
                    "client_id": "test-client-id",
                    "client_secret": "test-client-secret",
                    "user_info_mapping": {
                        "display_name": "nickname",
                        "email": "mail",
                    },
                    "email_fallback_domain": "idp.example.com",
                }
            ],
            "oauth_redirect_base_url": "http://testserver",
        }
    )


@pytest.fixture
async def fallback_app(
    fallback_settings, upstream_client, monkeypatch, mock_oauth_client
):
    from mineru_gateway.auth.oauth import base

    monkeypatch.setattr(
        base,
        "get_oauth_client",
        lambda name: mock_oauth_client if name == "keycloak" else None,
    )
    application = create_app(
        settings=fallback_settings, upstream_client=upstream_client
    )
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def fallback_client(fallback_app):
    transport = httpx.ASGITransport(app=fallback_app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as c:
        yield c


@pytest.fixture
def no_fallback_domain_settings(settings):
    """Settings without email_fallback_domain."""
    return settings.model_copy(
        update={
            "oidc_providers": [
                {
                    "name": "keycloak",
                    "openid_configuration_endpoint": "https://keycloak.example.com/.well-known/openid-configuration",
                    "client_id": "test-client-id",
                    "client_secret": "test-client-secret",
                    "user_info_mapping": {
                        "display_name": "name",
                        "email": "email",
                    },
                }
            ],
            "oauth_redirect_base_url": "http://testserver",
        }
    )


@pytest.fixture
async def no_fallback_app(
    no_fallback_domain_settings, upstream_client, monkeypatch, mock_oauth_client
):
    from mineru_gateway.auth.oauth import base

    monkeypatch.setattr(
        base,
        "get_oauth_client",
        lambda name: mock_oauth_client if name == "keycloak" else None,
    )
    application = create_app(
        settings=no_fallback_domain_settings, upstream_client=upstream_client
    )
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def no_fallback_client(no_fallback_app):
    transport = httpx.ASGITransport(app=no_fallback_app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as c:
        yield c


# ===== Helpers =====


async def _oauth_flow(client):
    """Helper: call authorize, extract state, call callback.

    Returns the callback response. Section 4.5 flow.
    """
    auth_resp = await client.get("/auth/oauth/keycloak/authorize")
    assert auth_resp.status_code == 302, auth_resp.text

    location = auth_resp.headers.get("location", "")
    params = parse_qs(urlparse(location).query)
    state = params.get("state", [""])[0]

    cb_resp = await client.get(
        f"/auth/oauth/keycloak/callback?code=test-code&state={state}"
    )
    return cb_resp


# ===== Section 4.5 step 3a: id_token fallback =====


async def test_callback_id_token_claims_used_when_no_userinfo(
    fallback_client, mock_oauth_client
):
    """Section 9.7: id_token in token response is decoded and claims used
    when userinfo_endpoint is not configured (get_profile returns empty)."""
    id_token = _make_id_token(
        {
            "sub": "idp-sub-456",
            "mail": "idtoken-user@example.com",
            "nickname": "IdTokenUser",
            "email_verified": True,
        }
    )
    mock_oauth_client.get_access_token = AsyncMock(
        return_value={
            "access_token": "oidc-access-token",
            "id_token": id_token,
            "token_type": "bearer",
        }
    )
    mock_oauth_client.get_profile = AsyncMock(return_value={})

    resp = await _oauth_flow(fallback_client)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["access_token"]

    token = body["access_token"]
    me = await fallback_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.status_code == 200
    assert me.json()["email"] == "idtoken-user@example.com"
    assert me.json()["display_name"] == "IdTokenUser"


# ===== Section 4.5 step 3c: userinfo overrides id_token =====


async def test_callback_userinfo_overrides_id_token(fallback_client, mock_oauth_client):
    """Section 9.7: when both id_token and userinfo exist, userinfo claims
    override id_token claims."""
    id_token = _make_id_token(
        {
            "sub": "idp-sub-456",
            "mail": "idtoken-email@example.com",
            "nickname": "IdTokenName",
            "email_verified": False,
        }
    )
    mock_oauth_client.get_access_token = AsyncMock(
        return_value={
            "access_token": "oidc-access-token",
            "id_token": id_token,
            "token_type": "bearer",
        }
    )
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "idp-sub-456",
            "mail": "userinfo-email@example.com",
            "nickname": "UserInfoName",
            "email_verified": True,
        }
    )

    resp = await _oauth_flow(fallback_client)
    assert resp.status_code == 200, resp.text

    token = resp.json()["access_token"]
    me = await fallback_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["email"] == "userinfo-email@example.com"
    assert me.json()["display_name"] == "UserInfoName"
    assert me.json()["is_verified"] is True


# ===== Section 3.2: user_info_mapping =====


async def test_callback_user_info_mapping_custom_fields(
    fallback_client, mock_oauth_client
):
    """Section 9.7: user_info_mapping renames claims before extraction.

    Provider has mapping {display_name: nickname, email: mail}.
    Profile returns 'mail' and 'nickname' instead of 'email' and 'name'.
    """
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "idp-sub-mapped",
            "mail": "mapped-user@example.com",
            "nickname": "MappedUser",
            "email_verified": True,
        }
    )

    resp = await _oauth_flow(fallback_client)
    assert resp.status_code == 200, resp.text

    token = resp.json()["access_token"]
    me = await fallback_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["email"] == "mapped-user@example.com"
    assert me.json()["display_name"] == "MappedUser"


# ===== Section 4.5 step 3f: email_fallback_domain =====


async def test_callback_email_fallback_domain_synthetic_email(
    fallback_client, mock_oauth_client
):
    """Section 9.7: email_fallback_domain configured, no email in claims ->
    synthetic email <sub>@<domain> is used."""
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "user-without-email",
            "nickname": "NoEmailUser",
            "email_verified": True,
        }
    )

    resp = await _oauth_flow(fallback_client)
    assert resp.status_code == 200, resp.text

    token = resp.json()["access_token"]
    me = await fallback_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["email"] == "user-without-email@idp.example.com"
    assert me.json()["display_name"] == "NoEmailUser"


async def test_callback_missing_email_no_fallback_returns_400(
    no_fallback_client, mock_oauth_client
):
    """Section 9.7: no email_fallback_domain configured and claims lack
    email -> 400."""
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "user-without-email",
            "name": "NoEmailUser",
            "email_verified": True,
        }
    )

    resp = await _oauth_flow(no_fallback_client)
    assert resp.status_code == 400


# ===== Section 4.5 step 3e: display_name fallback chain =====


async def test_callback_display_name_from_mapping_field(
    fallback_client, mock_oauth_client
):
    """Section 9.7: display_name is read from the mapped field (nickname)
    rather than the default 'name' field."""
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "idp-sub-dn",
            "mail": "displayname@example.com",
            "nickname": "FromNickname",
            "name": "IgnoredName",
            "email_verified": True,
        }
    )

    resp = await _oauth_flow(fallback_client)
    assert resp.status_code == 200, resp.text

    token = resp.json()["access_token"]
    me = await fallback_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["display_name"] == "FromNickname"


async def test_callback_display_name_mapped_field_empty_falls_to_literal_name(
    fallback_client, mock_oauth_client
):
    """Section 9.7: mapped display_name field is empty -> falls back to
    literal 'name' claim."""
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "idp-sub-dn2",
            "mail": "dn-test@example.com",
            "nickname": "",
            "name": "RealName",
            "email_verified": True,
        }
    )

    resp = await _oauth_flow(fallback_client)
    assert resp.status_code == 200, resp.text

    token = resp.json()["access_token"]
    me = await fallback_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["display_name"] == "RealName"


async def test_callback_display_name_email_local_part_with_custom_mapping(
    fallback_client, mock_oauth_client
):
    """Section 9.7: all display_name fields missing with custom mapping
    -> fallback to email local part."""
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "idp-sub-dn3",
            "mail": "test@example.com",
            "email_verified": True,
        }
    )

    resp = await _oauth_flow(fallback_client)
    assert resp.status_code == 200, resp.text

    token = resp.json()["access_token"]
    me = await fallback_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["display_name"] == "test"


# ===== Section 4.5 step 3f: display_name falls to sub with email_fallback =====


async def test_callback_display_name_falls_back_to_sub_when_email_fallback_used(
    fallback_client, mock_oauth_client
):
    """Section 9.7: email_fallback_domain used, no display_name fields
    -> display_name falls back to sub."""
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "some-sub",
            "email_verified": True,
        }
    )

    resp = await _oauth_flow(fallback_client)
    assert resp.status_code == 200, resp.text

    token = resp.json()["access_token"]
    me = await fallback_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["email"] == "some-sub@idp.example.com"
    assert me.json()["display_name"] == "some-sub"


async def test_callback_email_fallback_sub_priority(fallback_client, mock_oauth_client):
    """Section 9.7: sub for email fallback prefers id_token sub over
    userinfo sub when both exist."""
    id_token = _make_id_token(
        {
            "sub": "idp-sub",
            "email_verified": True,
        }
    )
    mock_oauth_client.get_access_token = AsyncMock(
        return_value={
            "access_token": "oidc-access-token",
            "id_token": id_token,
            "token_type": "bearer",
        }
    )
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "userinfo-sub",
            "email_verified": True,
        }
    )

    resp = await _oauth_flow(fallback_client)
    assert resp.status_code == 200, resp.text

    token = resp.json()["access_token"]
    me = await fallback_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["email"] == "idp-sub@idp.example.com"


# ===== Section 3.2/4.5 step 3g: email_verified is fixed mapping =====


async def test_callback_email_verified_not_affected_by_user_info_mapping(
    fallback_client, mock_oauth_client
):
    """Section 9.7: email_verified is a fixed mapping and NOT affected by
    user_info_mapping. Even if mapping includes an email_verified key,
    the claim is still read from claims.get('email_verified')."""
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "idp-sub-ev",
            "mail": "ev-test@example.com",
            "nickname": "EVUser",
            "email_verified": True,
        }
    )

    resp = await _oauth_flow(fallback_client)
    assert resp.status_code == 200, resp.text

    token = resp.json()["access_token"]
    me = await fallback_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["is_verified"] is True


async def test_callback_email_verified_false_when_claim_false(
    fallback_client, mock_oauth_client
):
    """Section 9.7: email_verified=False in claims results in
    is_verified=False, even if mapping exists."""
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "idp-sub-ev2",
            "mail": "ev2-test@example.com",
            "nickname": "EVUser2",
            "email_verified": False,
        }
    )

    resp = await _oauth_flow(fallback_client)
    assert resp.status_code == 200, resp.text

    token = resp.json()["access_token"]
    me = await fallback_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["is_verified"] is False


# ===== Section 4.5 step 3g: _coerce_email_verified unit tests =====


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (True, True),
        (False, False),
        ("true", True),
        ("false", False),
        (1, True),
        (0, False),
        (None, None),
        ("maybe", False),
        ({}, None),
    ],
)
def test_coerce_email_verified(value, expected):
    """Section 4.5 step 3g: _coerce_email_verified converts various
    claim values to bool or None."""
    from mineru_gateway.auth.oauth.routes import _coerce_email_verified

    result = _coerce_email_verified(value)
    assert result is expected or result == expected
