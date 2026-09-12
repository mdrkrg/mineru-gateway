"""Tests for user auth master toggle and existing endpoint regression.

Spec: user-management-and-oauth.md
  Section 6.3 - user auth master toggle (USER_AUTH_ENABLED)
  Section 9.8 - master toggle test points
  Section 9.9 - existing endpoint regression
  Section 4.6 - existing endpoints unchanged
"""

from __future__ import annotations


# ===== Section 6.3 / 9.8: USER_AUTH_ENABLED=false =====


async def test_disabled_user_auth_jwt_routes_return_404(no_auth_client):
    """Section 9.8: USER_AUTH_ENABLED=false -> all JWT routes 404."""
    endpoints = [
        ("/auth/jwt/login", "POST", {"email": "x@example.com", "password": "x"}),
        ("/auth/jwt/refresh", "POST", {"refresh_token": "x"}),
        ("/auth/jwt/logout", "POST", None),
        ("/auth/register", "POST", {"email": "x@example.com", "password": "x"}),
        ("/auth/users", "POST", {"email": "x@example.com", "password": "x"}),
    ]
    for path, method, body in endpoints:
        if body:
            resp = await no_auth_client.request(method, path, json=body)
        else:
            resp = await no_auth_client.request(method, path)
        assert resp.status_code == 404, f"{method} {path} returned {resp.status_code}"


async def test_disabled_user_auth_user_routes_return_404(no_auth_client):
    """Section 9.8: USER_AUTH_ENABLED=false -> /users/me 404."""
    resp = await no_auth_client.get("/users/me")
    assert resp.status_code == 404

    resp = await no_auth_client.patch("/users/me", json={"display_name": "X"})
    assert resp.status_code == 404


async def test_disabled_user_auth_api_keys_me_routes_return_404(no_auth_client):
    """Section 9.8: USER_AUTH_ENABLED=false -> /me/api-keys 404."""
    resp = await no_auth_client.get("/me/api-keys")
    assert resp.status_code == 404

    resp = await no_auth_client.post("/me/api-keys", json={"label": "x"})
    assert resp.status_code == 404


async def test_disabled_user_auth_oauth_routes_return_404(no_auth_client):
    """Section 9.8: USER_AUTH_ENABLED=false -> /auth/oauth/* 404."""
    resp = await no_auth_client.get("/auth/oauth/keycloak/authorize")
    assert resp.status_code == 404

    resp = await no_auth_client.get("/auth/oauth/keycloak/callback?code=x&state=x")
    assert resp.status_code == 404


# ===== Section 9.8: USER_AUTH_ENABLED=false, existing routes work =====


async def test_disabled_user_auth_admin_keys_route_works(no_auth_client, admin_headers):
    """Section 9.8: USER_AUTH_ENABLED=false -> /auth/keys works normally."""
    resp = await no_auth_client.post(
        "/auth/keys", json={"label": "test"}, headers=admin_headers
    )
    assert resp.status_code == 201

    resp = await no_auth_client.get("/auth/keys", headers=admin_headers)
    assert resp.status_code == 200


async def test_disabled_user_auth_health_route_works(no_auth_client):
    """Section 9.8: USER_AUTH_ENABLED=false -> /health works normally."""
    resp = await no_auth_client.get("/health")
    assert resp.status_code == 200


async def test_disabled_user_auth_business_routes_work(
    no_auth_client, admin_headers, sample_files
):
    """Section 9.8 / 4.6: USER_AUTH_ENABLED=false -> business routes work."""
    key_resp = await no_auth_client.post(
        "/auth/keys", json={"label": "biz"}, headers=admin_headers
    )
    assert key_resp.status_code == 201
    raw_key = key_resp.json()["api_key"]

    task_resp = await no_auth_client.post(
        "/tasks", headers={"X-API-Key": raw_key}, files=sample_files
    )
    assert task_resp.status_code == 202


# ===== Section 9.8: USER_AUTH_ENABLED=true, all routes work =====


async def test_enabled_user_auth_routes_accessible(client):
    """Section 9.8: USER_AUTH_ENABLED=true -> user/auth routes are registered.

    Each route answers with its normal status (401 without credentials) rather
    than 404. Deeper per-endpoint behaviour is covered by the dedicated test
    modules (test_info.py, test_api_keys.py, test_jwt_auth.py).
    """
    endpoints = [
        ("POST", "/auth/register", {"email": "x@example.com", "password": "x"}),
        ("POST", "/auth/jwt/login", {"email": "x@example.com", "password": "x"}),
        ("POST", "/auth/jwt/refresh", {"refresh_token": "x"}),
        ("POST", "/auth/jwt/logout", None),
        ("POST", "/auth/users", {"email": "x@example.com", "password": "x"}),
        ("GET", "/users/me", None),
        ("GET", "/me/api-keys", None),
    ]
    for method, path, body in endpoints:
        resp = await client.request(method, path, json=body)
        assert resp.status_code != 404, f"{method} {path} returned 404"


# ===== Section 9.9: Existing endpoint regression =====


async def test_auth_keys_create_unchanged(client, admin_headers):
    """Section 9.9 / 4.6: POST /auth/keys behavior unchanged."""
    resp = await client.post(
        "/auth/keys", json={"label": "regression"}, headers=admin_headers
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["api_key"].startswith("mru_")
    assert body["key_id"]
    # Admin-created keys have owner_id = NULL (Section 4.6)
    assert "owner_id" not in body or body.get("owner_id") is None


async def test_auth_keys_list_unchanged(client, admin_headers):
    """Section 9.9 / 4.6: GET /auth/keys behavior unchanged."""
    await client.post("/auth/keys", json={"label": "list-test"}, headers=admin_headers)
    resp = await client.get("/auth/keys", headers=admin_headers)
    assert resp.status_code == 200
    keys = resp.json()["keys"]
    assert len(keys) >= 1
    for k in keys:
        assert "api_key" not in k  # no plaintext
        assert k["is_active"] is True


async def test_auth_keys_revoke_unchanged(client, admin_headers, sample_files):
    """Section 9.9 / 4.6: DELETE /auth/keys/{id} behavior unchanged."""
    created = await client.post(
        "/auth/keys", json={"label": "revoke-test"}, headers=admin_headers
    )
    key_id = created.json()["key_id"]
    raw_key = created.json()["api_key"]

    # Key works before revocation
    ok = await client.post("/tasks", headers={"X-API-Key": raw_key}, files=sample_files)
    assert ok.status_code == 202

    # Revoke
    del_resp = await client.delete(f"/auth/keys/{key_id}", headers=admin_headers)
    assert del_resp.status_code == 204

    # Key rejected after revocation
    denied = await client.post(
        "/tasks", headers={"X-API-Key": raw_key}, files=sample_files
    )
    assert denied.status_code == 401


async def test_admin_keys_list_includes_user_created_keys(
    client, admin_headers, user_headers
):
    """Section 6.1: admin GET /auth/keys lists all keys including user-created."""
    # User creates a key
    user_resp = await client.post(
        "/me/api-keys", headers=user_headers, json={"label": "user-key"}
    )
    assert user_resp.status_code == 201

    # Admin creates a key
    admin_resp = await client.post(
        "/auth/keys", headers=admin_headers, json={"label": "admin-key"}
    )
    assert admin_resp.status_code == 201

    # Admin list should include both
    resp = await client.get("/auth/keys", headers=admin_headers)
    assert resp.status_code == 200
    labels = {k["label"] for k in resp.json()["keys"]}
    assert "user-key" in labels
    assert "admin-key" in labels


async def test_admin_can_revoke_user_created_key(
    client, admin_headers, user_headers, sample_files
):
    """Section 6.1: admin can revoke any key, including user-created."""
    # User creates a key
    created = await client.post(
        "/me/api-keys", headers=user_headers, json={"label": "user-key"}
    )
    key_id = created.json()["key_id"]
    raw_key = created.json()["api_key"]

    # Admin revokes it
    resp = await client.delete(f"/auth/keys/{key_id}", headers=admin_headers)
    assert resp.status_code == 204

    # Key no longer works
    denied = await client.post(
        "/tasks", headers={"X-API-Key": raw_key}, files=sample_files
    )
    assert denied.status_code == 401


async def test_business_endpoints_work_with_admin_key(
    client, admin_headers, sample_files
):
    """Section 9.9 / 4.6: business endpoints work with admin-created key."""
    key_resp = await client.post(
        "/auth/keys", json={"label": "biz-admin"}, headers=admin_headers
    )
    raw_key = key_resp.json()["api_key"]

    resp = await client.post(
        "/tasks", headers={"X-API-Key": raw_key}, files=sample_files
    )
    assert resp.status_code == 202


async def test_file_parse_endpoint_works_with_admin_key(
    client, admin_headers, sample_files
):
    """Section 9.9 / 4.6: POST /file_parse behavior unchanged."""
    key_resp = await client.post(
        "/auth/keys", json={"label": "parse-key"}, headers=admin_headers
    )
    raw_key = key_resp.json()["api_key"]

    resp = await client.post(
        "/file_parse", headers={"X-API-Key": raw_key}, files=sample_files
    )
    # file_parse is synchronous; status depends on mock upstream
    assert resp.status_code in (200, 202)


async def test_business_endpoints_work_with_user_key(
    client, user_headers, sample_files
):
    """Section 9.9 / 6.2: business endpoints work with user-created key."""
    key_resp = await client.post(
        "/me/api-keys", headers=user_headers, json={"label": "biz-user"}
    )
    raw_key = key_resp.json()["api_key"]

    resp = await client.post(
        "/tasks", headers={"X-API-Key": raw_key}, files=sample_files
    )
    assert resp.status_code == 202


async def test_health_route_unchanged(client):
    """Section 9.9 / 4.6: GET /health behavior unchanged."""
    resp = await client.get("/health")
    assert resp.status_code == 200


# ===== Section 3.1 / 7.1: JWT secret startup validation =====


def test_jwt_secret_too_short_rejects_startup(tmp_path):
    """Section 3.1 / 7.1: jwt_secret < 32 chars with user_auth_enabled -> reject."""
    import pytest

    from mineru_gateway.config import Settings
    from mineru_gateway.main import create_app

    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        admin_token="test",
        user_auth_enabled=True,
        jwt_secret="short",  # < 32 chars
        create_tables=True,
        enable_background=False,
    )
    with pytest.raises((ValueError, RuntimeError)):
        create_app(settings=settings)


def test_jwt_secret_long_enough_starts_successfully(tmp_path):
    """Section 3.1 / 7.1: jwt_secret >= 32 chars with user_auth_enabled -> OK."""
    from mineru_gateway.config import Settings
    from mineru_gateway.main import create_app

    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        admin_token="test",
        user_auth_enabled=True,
        jwt_secret="a" * 32,  # exactly 32 chars
        create_tables=True,
        enable_background=False,
        # Gate open: no SMTP configured, so no verification path exists
        # (spec: email-verification.md Section 3.1 startup validation).
        allow_unverified_accounts=True,
    )
    app = create_app(settings=settings)
    assert app is not None
