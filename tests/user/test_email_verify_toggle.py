"""Email verification master toggle, route registration, and gate independence.

Spec: email-verification.md
  Section 1   - feature switch matrix
  Section 6.1 - relationship with USER_AUTH_ENABLED
  Section 6.2 - pre-existing keys keep working
  Section 8.6 - POST /me/api-keys gate is SMTP-independent
  Section 8.8 - master toggle and route registration
"""

from __future__ import annotations

import uuid
from hashlib import sha256

from mineru_gateway.models import ApiKey


async def _register_and_login(client, email: str = "toggle-user@example.com"):
    """Register a user and return (payload, bearer headers)."""
    payload = {"email": email, "password": "secret123", "display_name": "Toggle"}
    resp = await client.post("/auth/register", json=payload)
    assert resp.status_code == 201, resp.text
    login = await client.post("/auth/jwt/login", json=payload)
    assert login.status_code == 200, login.text
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    return payload, headers


# ===== Section 8.8 / 6.1: USER_AUTH_ENABLED=false =====


async def test_verify_routes_404_when_user_auth_disabled(no_auth_client):
    """Section 8.8 / 6.1: USER_AUTH_ENABLED=false -> all verify endpoints 404."""
    resp = await no_auth_client.post(
        "/auth/request-verify-token", json={"email": "x@example.com"}
    )
    assert resp.status_code == 404
    resp = await no_auth_client.post("/auth/verify", json={"token": "x"})
    assert resp.status_code == 404
    resp = await no_auth_client.get("/auth/verify?token=x")
    assert resp.status_code == 404


# ===== Section 8.8 / 1: no SMTP -> verify routes not registered =====


async def test_verify_routes_404_without_smtp_when_gate_open(client):
    """Section 8.8 / 1: SMTP not configured + allow_unverified_accounts=true
    -> verify endpoints 404 and POST /me/api-keys is not gated."""
    resp = await client.post(
        "/auth/request-verify-token", json={"email": "x@example.com"}
    )
    assert resp.status_code == 404
    resp = await client.post("/auth/verify", json={"token": "x"})
    assert resp.status_code == 404
    resp = await client.get("/auth/verify?token=x")
    assert resp.status_code == 404

    _, headers = await _register_and_login(client, email="open-gate@example.com")
    created = await client.post("/me/api-keys", headers=headers, json={"label": "x"})
    assert created.status_code == 201


async def test_verify_routes_registered_when_smtp_configured(smtp_client):
    """Section 8.8 / 1: SMTP configured -> verify routes registered."""
    resp = await smtp_client.post(
        "/auth/request-verify-token", json={"email": "x@example.com"}
    )
    assert resp.status_code != 404
    resp = await smtp_client.post("/auth/verify", json={"token": "x"})
    assert resp.status_code != 404
    resp = await smtp_client.get("/auth/verify?token=x")
    assert resp.status_code != 404


# ===== Section 8.6 / 1: gate independence from SMTP configuration =====
# The 403 case with SMTP configured is covered by
# tests/user/test_api_keys.py (gated fixtures, Section 8.6); here only the
# gate-open side is pinned.


async def test_unverified_create_key_201_with_smtp_when_gate_open(smtp_client):
    """Section 8.6: unverified user + gate open + SMTP configured -> 201."""
    _, headers = await _register_and_login(smtp_client)
    resp = await smtp_client.post("/me/api-keys", headers=headers, json={"label": "ok"})
    assert resp.status_code == 201


# ===== Section 8.6: other endpoints unaffected by verification state =====


async def test_unverified_user_other_endpoints_unaffected(gated_smtp_client):
    """Section 8.6: login, refresh, /users/me, GET/DELETE /me/api-keys are not
    affected by the verification state."""
    payload, headers = await _register_and_login(gated_smtp_client)

    login = await gated_smtp_client.post(
        "/auth/jwt/login",
        json={"email": payload["email"], "password": payload["password"]},
    )
    assert login.status_code == 200
    refresh = await gated_smtp_client.post(
        "/auth/jwt/refresh", json={"refresh_token": login.json()["refresh_token"]}
    )
    assert refresh.status_code == 200

    me = await gated_smtp_client.get("/users/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["is_verified"] is False

    listed = await gated_smtp_client.get("/me/api-keys", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["keys"] == []

    dele = await gated_smtp_client.delete(
        f"/me/api-keys/{uuid.uuid4()}", headers=headers
    )
    assert dele.status_code == 404


async def test_unverified_user_existing_key_keeps_working(
    gated_smtp_app, gated_smtp_client, sample_files
):
    """Section 6.2 / 8.6: a key held before verification stays usable for
    task submission, and DELETE /me/api-keys works for the unverified owner."""
    payload, headers = await _register_and_login(
        gated_smtp_client, email="prekey@example.com"
    )
    me = await gated_smtp_client.get("/users/me", headers=headers)
    user_id = me.json()["id"]

    raw_key = "mru_prexistingkeyfortest"
    async with gated_smtp_app.state.db.session_factory() as session:
        session.add(
            ApiKey(
                key_hash=sha256(raw_key.encode()).hexdigest(),
                key_prefix=raw_key[:8],
                label="pre-verification",
                owner_id=uuid.UUID(user_id),
            )
        )
        await session.commit()

    task = await gated_smtp_client.post(
        "/tasks", headers={"X-API-Key": raw_key}, files=sample_files
    )
    assert task.status_code == 202

    listed = await gated_smtp_client.get("/me/api-keys", headers=headers)
    assert listed.status_code == 200
    keys = listed.json()["keys"]
    assert len(keys) == 1
    dele = await gated_smtp_client.delete(
        f"/me/api-keys/{keys[0]['id']}", headers=headers
    )
    assert dele.status_code == 204
