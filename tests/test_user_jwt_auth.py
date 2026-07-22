"""Tests for JWT login, refresh, and logout.

Spec: user-management-and-oauth.md
  Section 4.1 - login, refresh, logout endpoints
  Section 9.2 - login test points
  Section 9.3 - refresh token test points
  Section 9.4 - logout test points
  Section 7.1 - JWT secret, audience separation (access vs refresh)
"""

from __future__ import annotations

import jwt


# ===== Section 4.1 / 9.2: POST /auth/jwt/login =====


async def test_login_success_returns_token_pair(client, registered_user):
    """Section 9.2: correct email + password -> 200 + {access, refresh, token_type}."""
    resp = await client.post(
        "/auth/jwt/login",
        json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["access_token"] != body["refresh_token"]


async def test_login_wrong_password_returns_401(client, registered_user):
    """Section 9.2: wrong password -> 401."""
    resp = await client.post(
        "/auth/jwt/login",
        json={
            "email": registered_user["email"],
            "password": "wrong-password",
        },
    )
    assert resp.status_code == 401


async def test_login_nonexistent_email_returns_401(client):
    """Section 9.2: non-existent email -> 401 (same as bad password)."""
    resp = await client.post(
        "/auth/jwt/login",
        json={
            "email": "nobody@example.com",
            "password": "secret123",
        },
    )
    assert resp.status_code == 401


async def test_login_access_token_works_for_users_me(client, registered_user):
    """Section 9.2: returned access_token can call /users/me."""
    resp = await client.post(
        "/auth/jwt/login",
        json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        },
    )
    assert resp.status_code == 200
    token = resp.json()["access_token"]

    me = await client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == registered_user["email"]


async def test_login_refresh_token_works_for_refresh(client, registered_user):
    """Section 9.2: returned refresh_token can call /auth/jwt/refresh."""
    resp = await client.post(
        "/auth/jwt/login",
        json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        },
    )
    assert resp.status_code == 200
    refresh_token = resp.json()["refresh_token"]

    refresh_resp = await client.post(
        "/auth/jwt/refresh",
        json={"refresh_token": refresh_token},
    )
    assert refresh_resp.status_code == 200
    assert refresh_resp.json()["access_token"]


# ===== Section 4.1 / 9.3: POST /auth/jwt/refresh =====


async def test_refresh_valid_token_returns_new_access_token(client, registered_user):
    """Section 9.3: valid refresh_token -> 200 + {access_token, token_type}."""
    login = await client.post(
        "/auth/jwt/login",
        json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        },
    )
    refresh_token = login.json()["refresh_token"]

    resp = await client.post(
        "/auth/jwt/refresh",
        json={"refresh_token": refresh_token},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    # Section 4.1: refresh response does NOT include a new refresh_token
    assert "refresh_token" not in body


async def test_refresh_new_access_token_works_for_users_me(client, registered_user):
    """Section 9.3: new access_token from refresh can call /users/me."""
    login = await client.post(
        "/auth/jwt/login",
        json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        },
    )
    refresh_token = login.json()["refresh_token"]

    refresh_resp = await client.post(
        "/auth/jwt/refresh",
        json={"refresh_token": refresh_token},
    )
    assert refresh_resp.status_code == 200
    new_access = refresh_resp.json()["access_token"]

    me = await client.get(
        "/users/me", headers={"Authorization": f"Bearer {new_access}"}
    )
    assert me.status_code == 200
    assert me.json()["email"] == registered_user["email"]


async def test_refresh_expired_token_returns_401(client, registered_user, settings):
    """Section 9.3: expired refresh_token -> 401."""
    from datetime import datetime, timedelta, timezone

    expired_payload = {
        "sub": str(registered_user),
        "aud": ["fastapi-users:refresh"],
        "iat": datetime.now(timezone.utc) - timedelta(days=30),
        "exp": datetime.now(timezone.utc) - timedelta(days=29),
    }
    expired_token = jwt.encode(expired_payload, settings.jwt_secret, algorithm="HS256")

    resp = await client.post(
        "/auth/jwt/refresh",
        json={"refresh_token": expired_token},
    )
    assert resp.status_code == 401


async def test_refresh_invalid_signature_returns_401(client):
    """Section 9.3: wrong-signature refresh_token -> 401."""
    bad_token = jwt.encode(
        {"sub": "x", "aud": ["fastapi-users:refresh"]},
        "wrong-secret-key",
        algorithm="HS256",
    )
    resp = await client.post(
        "/auth/jwt/refresh",
        json={"refresh_token": bad_token},
    )
    assert resp.status_code == 401


async def test_refresh_using_access_token_returns_401(client, registered_user):
    """Section 9.3 / 7.1: using access_token as refresh_token -> 401 (audience mismatch)."""
    login = await client.post(
        "/auth/jwt/login",
        json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        },
    )
    access_token = login.json()["access_token"]

    resp = await client.post(
        "/auth/jwt/refresh",
        json={"refresh_token": access_token},
    )
    assert resp.status_code == 401


# ===== Section 4.1 / 9.4: POST /auth/jwt/logout =====


async def test_logout_with_valid_jwt_returns_200(client, user_headers):
    """Section 9.4: valid JWT -> 200."""
    resp = await client.post(
        "/auth/jwt/logout",
        headers=user_headers,
    )
    assert resp.status_code == 200
    assert "message" in resp.json()


async def test_logout_without_jwt_returns_401(client):
    """Section 9.4: no JWT -> 401."""
    resp = await client.post("/auth/jwt/logout")
    assert resp.status_code == 401


async def test_logout_with_invalid_jwt_returns_401(client):
    """Section 9.4: invalid JWT -> 401."""
    resp = await client.post(
        "/auth/jwt/logout",
        headers={"Authorization": "Bearer invalid-token-string"},
    )
    assert resp.status_code == 401


async def test_logout_is_stateless_token_still_works(
    client, registered_user, user_headers
):
    """Section 9.4: logout is stateless; access_token remains valid afterward.

    No server-side blacklist (Section 0 non-goals).
    """
    logout = await client.post("/auth/jwt/logout", headers=user_headers)
    assert logout.status_code == 200

    # Token should still work after logout (stateless, no blacklist)
    me = await client.get("/users/me", headers=user_headers)
    assert me.status_code == 200
