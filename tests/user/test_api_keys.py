"""Tests for self-service API Key management: /me/api-keys.

Spec: user-management-and-oauth.md
  Section 4.4 - list, create, revoke API keys (owner-scoped)
  Section 9.6 - API Key self-service test points
  Section 6.1 - relationship with admin API Key management
  Section 4.4 / 9.6 - verification gate (GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS)
"""

from __future__ import annotations

import uuid

import httpx
import pytest
from asgi_lifespan import LifespanManager

from mineru_gateway.main import create_app


# ===== Section 4.4 / 9.6: POST /me/api-keys (create) =====


async def test_create_my_key_returns_201(client, user_headers):
    """Section 9.6: POST /me/api-keys -> 201 + ApiKeyCreated."""
    resp = await client.post(
        "/me/api-keys",
        headers=user_headers,
        json={"label": "my-dev-key"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["api_key"].startswith("mru_")
    assert body["api_key_prefix"] == body["api_key"][:8]
    assert "key_id" in body
    assert "not be shown again" in body["message"].lower()


async def test_create_my_key_without_jwt_returns_401(client):
    """Section 9.6: no JWT -> 401."""
    resp = await client.post("/me/api-keys", json={"label": "x"})
    assert resp.status_code == 401


async def test_create_my_key_with_invalid_jwt_returns_401(client):
    """Section 9.6: invalid JWT -> 401."""
    resp = await client.post(
        "/me/api-keys",
        headers={"Authorization": "Bearer invalid"},
        json={"label": "x"},
    )
    assert resp.status_code == 401


async def test_create_my_key_without_label(client, user_headers):
    """Section 4.4: POST /me/api-keys without label -> 201, label defaults to ''."""
    resp = await client.post("/me/api-keys", headers=user_headers, json={})
    assert resp.status_code == 201
    body = resp.json()
    assert body["api_key"].startswith("mru_")

    listed = await client.get("/me/api-keys", headers=user_headers)
    keys = listed.json()["keys"]
    assert len(keys) == 1
    assert keys[0]["label"] == ""


async def test_create_my_key_with_expires_at(client, user_headers):
    """Section 4.4: POST /me/api-keys with expires_at -> 201."""
    from datetime import datetime, timedelta, timezone

    future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    resp = await client.post(
        "/me/api-keys",
        headers=user_headers,
        json={"label": "expiring", "expires_at": future},
    )
    assert resp.status_code == 201


async def test_create_my_key_with_invalid_expires_at_returns_422(client, user_headers):
    """Section 4.4: invalid expires_at format -> 422 (Pydantic datetime validation)."""
    resp = await client.post(
        "/me/api-keys",
        headers=user_headers,
        json={"label": "bad", "expires_at": "not-a-date"},
    )
    assert resp.status_code == 422


# ===== Section 4.4 / 9.6: GET /me/api-keys (list) =====


async def test_list_my_keys_returns_own_keys(client, user_headers):
    """Section 9.6: GET /me/api-keys lists only own keys."""
    await client.post("/me/api-keys", headers=user_headers, json={"label": "key-a"})
    await client.post("/me/api-keys", headers=user_headers, json={"label": "key-b"})

    resp = await client.get("/me/api-keys", headers=user_headers)
    assert resp.status_code == 200
    keys = resp.json()["keys"]
    assert len(keys) == 2
    labels = {k["label"] for k in keys}
    assert labels == {"key-a", "key-b"}
    # Should not include plaintext key
    for k in keys:
        assert "api_key" not in k
        assert k["is_active"] is True
        assert "api_key_prefix" in k
        assert k["api_key_prefix"]


async def test_list_my_keys_excludes_other_users_keys(
    client, registered_user, user_headers
):
    """Section 9.6: GET /me/api-keys does not include other users' keys."""
    # Create a key for the first user
    await client.post("/me/api-keys", headers=user_headers, json={"label": "my-key"})

    # Register a second user and create a key for them
    second_user = {
        "email": "bob@example.com",
        "password": "secret456",
        "display_name": "Bob",
    }
    await client.post("/auth/register", json=second_user)
    second_login = await client.post("/auth/jwt/login", json=second_user)
    second_token = second_login.json()["access_token"]
    second_headers = {"Authorization": f"Bearer {second_token}"}

    await client.post("/me/api-keys", headers=second_headers, json={"label": "bob-key"})

    # First user should only see their own key
    resp = await client.get("/me/api-keys", headers=user_headers)
    assert resp.status_code == 200
    keys = resp.json()["keys"]
    assert len(keys) == 1
    assert keys[0]["label"] == "my-key"
    assert keys[0]["api_key_prefix"]


async def test_list_my_keys_excludes_admin_created_keys(
    client, user_headers, admin_headers
):
    """Section 4.4 / 6.1: GET /me/api-keys excludes keys with owner_id=NULL (admin-created)."""
    # Admin creates a key (owner_id = NULL)
    await client.post("/auth/keys", headers=admin_headers, json={"label": "admin-key"})

    # User creates their own key
    await client.post("/me/api-keys", headers=user_headers, json={"label": "user-key"})

    # User should only see their own key
    resp = await client.get("/me/api-keys", headers=user_headers)
    assert resp.status_code == 200
    keys = resp.json()["keys"]
    assert len(keys) == 1
    assert keys[0]["label"] == "user-key"
    assert keys[0]["api_key_prefix"]


async def test_list_my_keys_without_jwt_returns_401(client):
    """Section 9.6: no JWT -> 401."""
    resp = await client.get("/me/api-keys")
    assert resp.status_code == 401


# ===== Section 4.4 / 9.6: DELETE /me/api-keys/{key_id} (revoke) =====


async def test_revoke_my_key_returns_204(client, user_headers):
    """Section 9.6: DELETE /me/api-keys/{id} -> 204."""
    created = await client.post(
        "/me/api-keys", headers=user_headers, json={"label": "revoke-me"}
    )
    key_id = created.json()["key_id"]

    resp = await client.delete(f"/me/api-keys/{key_id}", headers=user_headers)
    assert resp.status_code == 204

    # Verify key is revoked in list
    listed = await client.get("/me/api-keys", headers=user_headers)
    keys = listed.json()["keys"]
    revoked = [k for k in keys if k["id"] == key_id]
    assert len(revoked) == 1
    assert revoked[0]["is_active"] is False


async def test_revoke_key_not_owned_returns_404(client, admin_headers, user_headers):
    """Section 9.6 / 4.4: revoking a key not owned -> 404 (no enumeration)."""
    # Admin creates a key (owner_id = NULL)
    admin_key = await client.post(
        "/auth/keys", headers=admin_headers, json={"label": "admin-only"}
    )
    admin_key_id = admin_key.json()["key_id"]

    # User tries to revoke admin's key -> 404
    resp = await client.delete(f"/me/api-keys/{admin_key_id}", headers=user_headers)
    assert resp.status_code == 404


async def test_revoke_key_from_other_user_returns_404(
    client, registered_user, user_headers
):
    """Section 9.6 / 4.4: revoking another user's key -> 404 (unified, no enumeration)."""
    # User A creates a key
    created = await client.post(
        "/me/api-keys", headers=user_headers, json={"label": "user-a-key"}
    )
    user_a_key_id = created.json()["key_id"]

    # Register and login as User B
    second_user = {
        "email": "carol@example.com",
        "password": "secret789",
        "display_name": "Carol",
    }
    await client.post("/auth/register", json=second_user)
    second_login = await client.post("/auth/jwt/login", json=second_user)
    second_headers = {"Authorization": f"Bearer {second_login.json()['access_token']}"}

    # User B tries to revoke User A's key -> 404
    resp = await client.delete(f"/me/api-keys/{user_a_key_id}", headers=second_headers)
    assert resp.status_code == 404


async def test_revoke_nonexistent_key_returns_404(client, user_headers):
    """Section 4.4: revoking non-existent key -> 404."""
    fake_id = str(uuid.uuid4())
    resp = await client.delete(f"/me/api-keys/{fake_id}", headers=user_headers)
    assert resp.status_code == 404


async def test_revoke_key_invalid_uuid_returns_422(client, user_headers):
    """Section 4.4: invalid UUID format -> 422."""
    resp = await client.delete("/me/api-keys/not-a-uuid", headers=user_headers)
    assert resp.status_code == 422


async def test_revoke_my_key_without_jwt_returns_401(client):
    """Section 9.6: no JWT -> 401."""
    resp = await client.delete(f"/me/api-keys/{uuid.uuid4()}")
    assert resp.status_code == 401


# ===== Section 9.6 / 6.2: Created key works for business endpoints =====


async def test_user_created_key_works_for_tasks(client, user_headers, sample_files):
    """Section 9.6 / 6.2: key created via /me/api-keys works for POST /tasks."""
    created = await client.post(
        "/me/api-keys", headers=user_headers, json={"label": "task-key"}
    )
    raw_key = created.json()["api_key"]

    resp = await client.post(
        "/tasks", headers={"X-API-Key": raw_key}, files=sample_files
    )
    assert resp.status_code == 202


# ===== Section 3.1 / 4.4 / 9.6: verification gate =====
# GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS (user-management-and-oauth.md §3.1):
# default false -> unverified users get 403 on POST /me/api-keys.
#
# The setting is pinned explicitly in the fixtures so the tests do not
# depend on the shared `settings` fixture's defaults (tests/conftest.py).


@pytest.fixture
def gated_settings(settings):
    """Verification gate enabled: allow_unverified_accounts=false."""
    return settings.model_copy(update={"allow_unverified_accounts": False})


@pytest.fixture
async def gated_app(gated_settings, upstream_client):
    application = create_app(settings=gated_settings, upstream_client=upstream_client)
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def gated_client(gated_app):
    transport = httpx.ASGITransport(app=gated_app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as c:
        yield c


async def _register_and_login(client) -> dict:
    """Register an unverified user (is_verified=false) and return headers."""
    payload = {
        "email": "gate-user@example.com",
        "password": "secret123",
        "display_name": "Gate User",
    }
    resp = await client.post("/auth/register", json=payload)
    assert resp.status_code == 201, resp.text
    login = await client.post("/auth/jwt/login", json=payload)
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def test_create_my_key_unverified_returns_403_when_gate_enabled(gated_client):
    """Section 4.4/9.6: unverified user + allow_unverified_accounts=false
    (default) -> 403, no key created."""
    headers = await _register_and_login(gated_client)
    resp = await gated_client.post(
        "/me/api-keys", headers=headers, json={"label": "gated-key"}
    )
    assert resp.status_code == 403
    listed = await gated_client.get("/me/api-keys", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["keys"] == []
