"""Tests for OIDCProviderConfig model validation (Section 3.2).

Spec: user-management-and-oauth.md
  Section 3.2 - OIDC provider configuration format
  Section 3.2 field table - Mode A / Mode B validation rules
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from mineru_gateway.config import OIDCProviderConfig


# ===== Section 3.2: Mode A (Discovery) =====


def test_mode_a_requires_discovery_endpoint():
    """Section 3.2: Mode A requires openid_configuration_endpoint."""
    cfg = OIDCProviderConfig(
        name="keycloak",
        openid_configuration_endpoint="https://idp.example.com/.well-known/openid-configuration",
        client_id="cid",
        client_secret="secret",
    )
    assert cfg.name == "keycloak"


def test_mode_a_ignores_manual_endpoints():
    """Section 3.2: Mode A ignores authorization_endpoint, token_endpoint,
    userinfo_endpoint when discovery is set. Their values are None."""
    cfg = OIDCProviderConfig(
        name="keycloak",
        openid_configuration_endpoint="https://idp.example.com/.well-known/openid-configuration",
        client_id="cid",
        client_secret="secret",
        authorization_endpoint="https://idp.example.com/auth",
        token_endpoint="https://idp.example.com/token",
        userinfo_endpoint="https://idp.example.com/userinfo",
    )
    assert cfg.name == "keycloak"
    assert cfg.authorization_endpoint is None
    assert cfg.token_endpoint is None
    assert cfg.userinfo_endpoint is None


# ===== Section 3.2: Mode B (Manual) =====


def test_mode_b_requires_auth_and_token():
    """Section 3.2: Mode B requires authorization_endpoint and token_endpoint."""
    cfg = OIDCProviderConfig(
        name="manual",
        client_id="cid",
        client_secret="secret",
        authorization_endpoint="https://idp.example.com/auth",
        token_endpoint="https://idp.example.com/token",
    )
    assert cfg.authorization_endpoint == "https://idp.example.com/auth"
    assert cfg.token_endpoint == "https://idp.example.com/token"


def test_mode_b_userinfo_optional():
    """Section 3.2: Mode B userinfo_endpoint is optional."""
    cfg = OIDCProviderConfig(
        name="manual",
        client_id="cid",
        client_secret="secret",
        authorization_endpoint="https://idp.example.com/auth",
        token_endpoint="https://idp.example.com/token",
    )
    assert cfg.userinfo_endpoint is None


def test_mode_b_with_userinfo():
    """Section 3.2: Mode B accepts optional userinfo_endpoint."""
    cfg = OIDCProviderConfig(
        name="manual",
        client_id="cid",
        client_secret="secret",
        authorization_endpoint="https://idp.example.com/auth",
        token_endpoint="https://idp.example.com/token",
        userinfo_endpoint="https://idp.example.com/userinfo",
    )
    assert cfg.userinfo_endpoint == "https://idp.example.com/userinfo"


def test_mode_b_missing_auth_endpoint_raises():
    """Section 3.2: Mode B without authorization_endpoint raises error."""
    with pytest.raises((ValueError, ValidationError)):
        OIDCProviderConfig(
            name="bad",
            client_id="cid",
            client_secret="secret",
            token_endpoint="https://idp.example.com/token",
        )


def test_mode_b_missing_token_endpoint_raises():
    """Section 3.2: Mode B without token_endpoint raises error."""
    with pytest.raises((ValueError, ValidationError)):
        OIDCProviderConfig(
            name="bad",
            client_id="cid",
            client_secret="secret",
            authorization_endpoint="https://idp.example.com/auth",
        )


def test_mode_b_missing_both_endpoints_raises():
    """Section 3.2: Mode B without both endpoints raises error."""
    with pytest.raises((ValueError, ValidationError)):
        OIDCProviderConfig(
            name="bad",
            client_id="cid",
            client_secret="secret",
        )


# ===== Section 3.2: scopes =====


def test_scopes_default():
    """Section 3.2: Default scopes is ["openid", "email"]."""
    cfg = OIDCProviderConfig(
        name="keycloak",
        openid_configuration_endpoint="https://idp.example.com/.well-known/openid-configuration",
        client_id="cid",
        client_secret="secret",
    )
    assert cfg.scopes == ["openid", "email"]


def test_scopes_custom():
    """Section 3.2: scopes can be overridden."""
    cfg = OIDCProviderConfig(
        name="keycloak",
        openid_configuration_endpoint="https://idp.example.com/.well-known/openid-configuration",
        client_id="cid",
        client_secret="secret",
        scopes=["openid", "email", "offline_access"],
    )
    assert cfg.scopes == ["openid", "email", "offline_access"]


# ===== Section 3.2: user_info_mapping =====


def test_user_info_mapping_default():
    """Section 3.2: Default mapping is {display_name: name, email: email}."""
    cfg = OIDCProviderConfig(
        name="keycloak",
        openid_configuration_endpoint="https://idp.example.com/.well-known/openid-configuration",
        client_id="cid",
        client_secret="secret",
    )
    assert cfg.user_info_mapping == {"display_name": "name", "email": "email"}


def test_user_info_mapping_custom():
    """Section 3.2: user_info_mapping can be overridden."""
    cfg = OIDCProviderConfig(
        name="keycloak",
        openid_configuration_endpoint="https://idp.example.com/.well-known/openid-configuration",
        client_id="cid",
        client_secret="secret",
        user_info_mapping={"display_name": "nickname", "email": "mail"},
    )
    assert cfg.user_info_mapping == {"display_name": "nickname", "email": "mail"}


# ===== Section 3.2: email_fallback_domain =====


def test_email_fallback_domain_default():
    """Section 3.2: email_fallback_domain defaults to None."""
    cfg = OIDCProviderConfig(
        name="keycloak",
        openid_configuration_endpoint="https://idp.example.com/.well-known/openid-configuration",
        client_id="cid",
        client_secret="secret",
    )
    assert cfg.email_fallback_domain is None


def test_email_fallback_domain_set():
    """Section 3.2: email_fallback_domain can be configured."""
    cfg = OIDCProviderConfig(
        name="keycloak",
        openid_configuration_endpoint="https://idp.example.com/.well-known/openid-configuration",
        client_id="cid",
        client_secret="secret",
        email_fallback_domain="idp.example.com",
    )
    assert cfg.email_fallback_domain == "idp.example.com"


# ===== Section 3.2: name validation =====


def test_name_required():
    """Section 3.2: name is required."""
    with pytest.raises((ValueError, ValidationError)):
        OIDCProviderConfig(
            client_id="cid",
            client_secret="secret",
            openid_configuration_endpoint="https://example.com/.well-known/openid-configuration",
        )


def test_client_id_required():
    """Section 3.2: client_id is required."""
    with pytest.raises((ValueError, ValidationError)):
        OIDCProviderConfig(
            name="keycloak",
            client_secret="secret",
            openid_configuration_endpoint="https://example.com/.well-known/openid-configuration",
        )


def test_client_secret_required():
    """Section 3.2: client_secret is required."""
    with pytest.raises((ValueError, ValidationError)):
        OIDCProviderConfig(
            name="keycloak",
            client_id="cid",
            openid_configuration_endpoint="https://example.com/.well-known/openid-configuration",
        )


def test_name_url_safe():
    """Section 3.2: name must be URL-safe (letters, digits, hyphens)."""
    with pytest.raises((ValueError, ValidationError)):
        OIDCProviderConfig(
            name="my provider!",
            client_id="cid",
            client_secret="secret",
            openid_configuration_endpoint="https://example.com/.well-known/openid-configuration",
        )


def test_name_with_underscore_rejected():
    """Section 3.2: underscores are not URL-safe."""
    with pytest.raises((ValueError, ValidationError)):
        OIDCProviderConfig(
            name="my_provider",
            client_id="cid",
            client_secret="secret",
            openid_configuration_endpoint="https://example.com/.well-known/openid-configuration",
        )


# ===== Section 3.2: Settings-level validation =====


def test_provider_names_must_be_unique():
    """Section 3.2: provider names must be unique within GATEWAY_OIDC_PROVIDERS."""
    from mineru_gateway.config import Settings

    with pytest.raises((ValueError, ValidationError)):
        Settings(
            database_url="sqlite+aiosqlite:///:memory:",
            user_auth_enabled=True,
            jwt_secret="a" * 32,
            create_tables=True,
            oidc_providers=[
                {
                    "name": "dup",
                    "openid_configuration_endpoint": "https://a.example.com/.well-known/openid-configuration",
                    "client_id": "cid1",
                    "client_secret": "secret1",
                },
                {
                    "name": "dup",
                    "openid_configuration_endpoint": "https://b.example.com/.well-known/openid-configuration",
                    "client_id": "cid2",
                    "client_secret": "secret2",
                },
            ],
        )
