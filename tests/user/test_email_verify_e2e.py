"""End-to-end email verification flows.

Spec: email-verification.md
  Section 8.7 - end-to-end test points (register, OIDC, resend, verify,
  then self-service API key creation)
"""

from __future__ import annotations

from unittest.mock import AsyncMock


async def test_e2e_register_auto_verify_then_create_key(
    gated_smtp_client, email_sender
):
    """Section 8.7: register (SMTP) -> captured token -> POST /auth/verify ->
    POST /me/api-keys succeeds."""
    payload = {
        "email": "e2e-flow1@example.com",
        "password": "secret123",
        "display_name": "E2EFlow1",
    }
    reg = await gated_smtp_client.post("/auth/register", json=payload)
    assert reg.status_code == 201
    assert len(email_sender.sent) == 1

    verify = await gated_smtp_client.post(
        "/auth/verify", json={"token": email_sender.sent[0]["token"]}
    )
    assert verify.status_code == 200
    assert verify.json()["is_verified"] is True

    login = await gated_smtp_client.post("/auth/jwt/login", json=payload)
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    me = await gated_smtp_client.get("/users/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["is_verified"] is True
    created = await gated_smtp_client.post(
        "/me/api-keys", headers=headers, json={"label": "e2e-key"}
    )
    assert created.status_code == 201


async def test_e2e_403_then_request_verify_then_create_key(
    gated_smtp_client, email_sender
):
    """Section 8.7: register -> 403 on key create -> request-verify-token ->
    verify -> key create succeeds."""
    payload = {
        "email": "e2e-flow2@example.com",
        "password": "secret123",
        "display_name": "E2EFlow2",
    }
    await gated_smtp_client.post("/auth/register", json=payload)
    login = await gated_smtp_client.post("/auth/jwt/login", json=payload)
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    blocked = await gated_smtp_client.post(
        "/me/api-keys", headers=headers, json={"label": "blocked"}
    )
    assert blocked.status_code == 403

    email_sender.reset()
    req = await gated_smtp_client.post(
        "/auth/request-verify-token", json={"email": payload["email"]}
    )
    assert req.status_code == 202
    assert len(email_sender.sent) == 1

    verify = await gated_smtp_client.post(
        "/auth/verify", json={"token": email_sender.sent[0]["token"]}
    )
    assert verify.status_code == 200

    created = await gated_smtp_client.post(
        "/me/api-keys", headers=headers, json={"label": "e2e-key"}
    )
    assert created.status_code == 201


async def test_e2e_oidc_unverified_verify_then_create_key(
    gated_smtp_oidc_client, mock_oauth_client, email_sender, oauth_flow
):
    """Section 8.7: OIDC email_verified=false -> unverified user -> 403 ->
    request-verify-token -> verify -> key create succeeds."""
    mock_oauth_client.get_profile = AsyncMock(
        return_value={
            "sub": "oidc-e2e-1",
            "email": "oidc-e2e@example.com",
            "name": "OidcE2E",
            "email_verified": False,
        }
    )
    cb = await oauth_flow(gated_smtp_oidc_client)
    assert cb.status_code == 200, cb.text
    assert email_sender.sent == []
    headers = {"Authorization": f"Bearer {cb.json()['access_token']}"}

    me = await gated_smtp_oidc_client.get("/users/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["is_verified"] is False

    blocked = await gated_smtp_oidc_client.post(
        "/me/api-keys", headers=headers, json={"label": "blocked"}
    )
    assert blocked.status_code == 403

    req = await gated_smtp_oidc_client.post(
        "/auth/request-verify-token", json={"email": "oidc-e2e@example.com"}
    )
    assert req.status_code == 202
    assert len(email_sender.sent) == 1

    verify = await gated_smtp_oidc_client.post(
        "/auth/verify", json={"token": email_sender.sent[0]["token"]}
    )
    assert verify.status_code == 200

    created = await gated_smtp_oidc_client.post(
        "/me/api-keys", headers=headers, json={"label": "e2e-key"}
    )
    assert created.status_code == 201
