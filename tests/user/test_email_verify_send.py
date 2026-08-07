"""Automatic verification email sending on user creation.

Spec: email-verification.md
  Section 4.4 - verification email content and send timing
  Section 8.2 - register / admin create test points
"""

from __future__ import annotations

from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlparse

import httpx
import pytest


async def _oauth_flow(client) -> httpx.Response:
    """Run authorize + callback for the mock keycloak provider (Section 4.5).

    Returns the callback response.
    """
    auth_resp = await client.get("/auth/oauth/keycloak/authorize")
    assert auth_resp.status_code == 302, auth_resp.text
    location = auth_resp.headers.get("location", "")
    state = parse_qs(urlparse(location).query).get("state", [""])[0]
    return await client.get(
        f"/auth/oauth/keycloak/callback?code=test-code&state={state}"
    )


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


async def test_register_with_undeterminable_sender_sends_nothing(
    smtp_no_sender_client, email_sender
):
    """Section 4.4 / 8.2: SMTP host set but sender address undeterminable ->
    register still 201, no email sent (the Section 4.1 sender constraint also
    applies to the automatic send)."""
    resp = await smtp_no_sender_client.post(
        "/auth/register",
        json={
            "email": "no-sender@example.com",
            "password": "secret123",
            "display_name": "NoSender",
        },
    )
    assert resp.status_code == 201
    assert email_sender.sent == []


async def test_admin_create_with_undeterminable_sender_sends_nothing(
    smtp_no_sender_client, admin_headers, email_sender
):
    """Section 4.4 / 8.2: admin create with undeterminable sender address ->
    201, no email sent."""
    resp = await smtp_no_sender_client.post(
        "/auth/users",
        headers=admin_headers,
        json={
            "email": "no-sender-admin@example.com",
            "password": "secret123",
            "display_name": "NoSenderAdmin",
        },
    )
    assert resp.status_code == 201
    assert email_sender.sent == []


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
    smtp_oidc_client, mock_oauth_client, email_sender, profile, expected_verified
):
    """Section 8.2 / 4.4: OIDC-created users never get an automatic email,
    whether the provider reports the email unverified, omits the claim, or
    reports it verified."""
    mock_oauth_client.get_profile = AsyncMock(return_value=profile)
    resp = await _oauth_flow(smtp_oidc_client)
    assert resp.status_code == 200, resp.text
    assert email_sender.sent == []

    token = resp.json()["access_token"]
    me = await smtp_oidc_client.get(
        "/users/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.json()["is_verified"] is expected_verified
