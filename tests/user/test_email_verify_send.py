"""Automatic verification email sending on user creation.

Spec: email-verification.md
  Section 4.4 - verification email content and send timing
  Section 8.2 - register / admin create test points
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest


# ===== Section 8.2: register / admin create keep is_verified=false =====


async def test_register_with_smtp_returns_201_unverified(smtp_client):
    """Section 8.2: register with SMTP configured -> 201, is_verified=false."""
    resp = await smtp_client.post(
        "/auth/register",
        json={
            "email": "smtp-reg@example.com",
            "password": "secret123",
            "display_name": "SmtpReg",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["is_verified"] is False


async def test_admin_create_with_smtp_returns_201_unverified(
    smtp_client, admin_headers
):
    """Section 8.2: admin create with SMTP configured -> 201, is_verified=false."""
    resp = await smtp_client.post(
        "/auth/users",
        headers=admin_headers,
        json={
            "email": "smtp-admin@example.com",
            "password": "secret123",
            "display_name": "SmtpAdmin",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["is_verified"] is False


# ===== Section 4.4 / 8.2: automatic send on register / admin create =====


async def test_register_sends_verification_email(smtp_client, email_sender):
    """Section 8.2: register with SMTP configured -> one email to the
    registered address carrying a non-empty verification token."""
    email = "auto-send@example.com"
    resp = await smtp_client.post(
        "/auth/register",
        json={"email": email, "password": "secret123", "display_name": "AutoSend"},
    )
    assert resp.status_code == 201
    assert len(email_sender.sent) == 1
    assert email_sender.sent[0]["user_email"] == email
    assert email_sender.sent[0]["token"]


async def test_admin_create_sends_verification_email(
    smtp_client, admin_headers, email_sender
):
    """Section 8.2 / 4.4: admin create with SMTP configured -> email sent to
    the created user's address."""
    email = "admin-send@example.com"
    resp = await smtp_client.post(
        "/auth/users",
        headers=admin_headers,
        json={
            "email": email,
            "password": "secret123",
            "display_name": "AdminSend",
        },
    )
    assert resp.status_code == 201
    assert len(email_sender.sent) == 1
    assert email_sender.sent[0]["user_email"] == email
    assert email_sender.sent[0]["token"]


async def test_register_without_smtp_sends_nothing(client, email_sender):
    """Section 8.2 / 4.4: SMTP not configured -> still 201, no email sent."""
    resp = await client.post(
        "/auth/register",
        json={
            "email": "no-smtp@example.com",
            "password": "secret123",
            "display_name": "NoSmtp",
        },
    )
    assert resp.status_code == 201
    assert email_sender.sent == []


async def test_register_send_failure_does_not_break_registration(
    smtp_client, email_sender
):
    """Section 4.4 / 7: a send failure is logged and does not break the flow
    -> register still 201, user created unverified."""
    email_sender.raise_error = RuntimeError("smtp down")
    resp = await smtp_client.post(
        "/auth/register",
        json={
            "email": "send-fail@example.com",
            "password": "secret123",
            "display_name": "SendFail",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["is_verified"] is False


# ===== Section 4.4 / 8.2: OIDC callback never auto-sends =====


@pytest.mark.parametrize(
    ("profile", "expected_verified"),
    [
        (
            {
                "sub": "oidc-uv-false",
                "email": "oidc-uv-false@example.com",
                "name": "OidcFalse",
                "email_verified": False,
            },
            False,
        ),
        (
            {
                "sub": "oidc-uv-missing",
                "email": "oidc-uv-missing@example.com",
                "name": "OidcMissing",
            },
            False,
        ),
        (
            {
                "sub": "oidc-uv-true",
                "email": "oidc-uv-true@example.com",
                "name": "OidcTrue",
                "email_verified": True,
            },
            True,
        ),
    ],
)
async def test_oidc_callback_never_sends_verification_email(
    smtp_oidc_client,
    mock_oauth_client,
    email_sender,
    oauth_flow,
    profile,
    expected_verified,
):
    """Section 8.2 / 4.4: OIDC-created users never get an automatic email,
    whether the provider reports the email unverified, omits the claim, or
    reports it verified."""
    mock_oauth_client.get_profile = AsyncMock(return_value=profile)
    resp = await oauth_flow(smtp_oidc_client)
    assert resp.status_code == 200, resp.text
    assert email_sender.sent == []

    token = resp.json()["access_token"]
    me = await smtp_oidc_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["is_verified"] is expected_verified
