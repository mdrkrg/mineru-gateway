"""Email verification configuration tests.

Spec: email-verification.md
  Section 3.1 - new settings, defaults, startup validation rules
  Section 8.1 - config validation test points
"""

from __future__ import annotations

import pytest

from mineru_gateway.config import Settings


def _base_settings(tmp_path, **extra) -> Settings:
    """Settings with user auth enabled and a long JWT secret."""
    return Settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        admin_token="test-admin-token",
        user_auth_enabled=True,
        jwt_secret="test-jwt-secret-at-least-32-characters",
        create_tables=True,
        enable_background=False,
        **extra,
    )


# ===== Section 8.1 / 3.1: defaults =====


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        ("smtp_host", None),
        ("smtp_port", 587),
        ("smtp_username", None),
        ("smtp_password", None),
        ("smtp_from", None),
        ("smtp_from_name", "mineru-gateway"),
        ("smtp_starttls", True),
        ("smtp_ssl_tls", False),
        ("smtp_timeout", 10),
        ("verify_email_token_lifetime_seconds", 3600),
        ("verify_email_base_url", ""),
    ],
)
def test_smtp_setting_defaults(tmp_path, field, expected):
    """Section 8.1: new settings default to the Section 3.1 table values."""
    settings = _base_settings(tmp_path)
    assert getattr(settings, field) == expected


# ===== Section 3.1 / 8.1: validation rules =====


def test_starttls_and_ssl_tls_mutually_exclusive(tmp_path):
    """Section 8.1: STARTTLS=true and SSL_TLS=true together -> rejected."""
    with pytest.raises(ValueError):
        _base_settings(tmp_path, smtp_starttls=True, smtp_ssl_tls=True)


def test_smtp_from_invalid_email_rejected(tmp_path):
    """Section 3.1 / 8.1: SMTP_FROM must be a valid email address."""
    with pytest.raises(ValueError):
        _base_settings(tmp_path, smtp_from="not-an-email")


def test_smtp_from_valid_email_accepted(tmp_path):
    """Section 3.1: a valid SMTP_FROM address is accepted."""
    settings = _base_settings(tmp_path, smtp_from="sender@example.com")
    assert settings.smtp_from == "sender@example.com"


# ===== Section 3.1 / 8.1: sender address required when SMTP configured =====


def test_smtp_host_without_sender_rejected(tmp_path):
    """Section 3.1 / 8.1: SMTP_HOST configured but neither SMTP_FROM nor
    SMTP_USERNAME -> rejected."""
    from mineru_gateway.main import create_app

    with pytest.raises((ValueError, RuntimeError)):
        settings = _base_settings(tmp_path, smtp_host="smtp.example.com")
        create_app(settings=settings)


def test_smtp_host_with_username_accepted(tmp_path):
    """Section 3.1: SMTP_HOST + SMTP_USERNAME (FROM falls back to it) -> OK."""
    settings = _base_settings(
        tmp_path, smtp_host="smtp.example.com", smtp_username="sender@example.com"
    )
    assert settings.smtp_host == "smtp.example.com"


def test_smtp_host_with_from_accepted(tmp_path):
    """Section 3.1: SMTP_HOST + SMTP_FROM -> OK."""
    settings = _base_settings(
        tmp_path, smtp_host="smtp.example.com", smtp_from="sender@example.com"
    )
    assert settings.smtp_host == "smtp.example.com"


# ===== Section 3.1: startup validation (gate closed, no SMTP path) =====


def test_startup_rejected_without_smtp_when_gate_closed(tmp_path):
    """Section 3.1 / 8.8: user_auth_enabled + allow_unverified_accounts=false
    (default) + no SMTP -> refuse startup (no verification path exists)."""
    from mineru_gateway.main import create_app

    with pytest.raises((ValueError, RuntimeError)):
        settings = Settings(
            database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
            admin_token="test-admin-token",
            user_auth_enabled=True,
            jwt_secret="test-jwt-secret-at-least-32-characters",
            create_tables=True,
            enable_background=False,
            allow_unverified_accounts=False,
        )
        create_app(settings=settings)


def test_startup_ok_with_smtp_when_gate_closed(tmp_path):
    """Section 3.1: SMTP configured + gate closed -> startup OK."""
    from mineru_gateway.main import create_app

    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        admin_token="test-admin-token",
        user_auth_enabled=True,
        jwt_secret="test-jwt-secret-at-least-32-characters",
        create_tables=True,
        enable_background=False,
        allow_unverified_accounts=False,
        smtp_host="smtp.example.com",
        smtp_from="sender@example.com",
    )
    app = create_app(settings=settings)
    assert app is not None


def test_startup_ok_without_smtp_when_gate_open(tmp_path):
    """Section 3.1: no SMTP + allow_unverified_accounts=true -> startup OK."""
    from mineru_gateway.main import create_app

    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        admin_token="test-admin-token",
        user_auth_enabled=True,
        jwt_secret="test-jwt-secret-at-least-32-characters",
        create_tables=True,
        enable_background=False,
        allow_unverified_accounts=True,
    )
    app = create_app(settings=settings)
    assert app is not None
