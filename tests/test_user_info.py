"""Tests for user info endpoints: GET/PATCH /users/me.

Spec: user-management-and-oauth.md
  Section 4.3 - get current user, update current user
  Section 9.5 - user info test points
"""

from __future__ import annotations


# ===== Section 4.3 / 9.5: GET /users/me =====


async def test_get_me_returns_current_user(client, registered_user, user_headers):
    """Section 9.5: GET /users/me returns current user info."""
    resp = await client.get("/users/me", headers=user_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == registered_user["email"]
    assert body["display_name"] == registered_user["display_name"]
    assert body["is_active"] is True
    assert body["is_superuser"] is False
    assert "id" in body
    assert "created_at" in body
    assert "updated_at" in body


async def test_get_me_without_jwt_returns_401(client):
    """Section 9.5: no JWT -> 401."""
    resp = await client.get("/users/me")
    assert resp.status_code == 401


async def test_get_me_with_invalid_jwt_returns_401(client):
    """Section 9.5: invalid JWT -> 401."""
    resp = await client.get(
        "/users/me", headers={"Authorization": "Bearer invalid-token"}
    )
    assert resp.status_code == 401


# ===== Section 4.3 / 9.5: PATCH /users/me =====


async def test_update_me_display_name(client, registered_user, user_headers):
    """Section 9.5: PATCH /users/me updates display_name."""
    resp = await client.patch(
        "/users/me",
        headers=user_headers,
        json={"display_name": "New Name"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["display_name"] == "New Name"
    assert body["email"] == registered_user["email"]


async def test_update_me_password(client, registered_user, user_headers):
    """Section 9.5: PATCH /users/me updates password; new password works for login."""
    new_password = "newpass456"
    resp = await client.patch(
        "/users/me",
        headers=user_headers,
        json={"password": new_password},
    )
    assert resp.status_code == 200

    # Verify new password works for login
    login = await client.post(
        "/auth/jwt/login",
        json={
            "email": registered_user["email"],
            "password": new_password,
        },
    )
    assert login.status_code == 200

    # Old password should no longer work
    old_login = await client.post(
        "/auth/jwt/login",
        json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        },
    )
    assert old_login.status_code == 401


async def test_update_me_email_not_mutable(client, registered_user, user_headers):
    """Section 4.3 / 9.5: email cannot be changed via PATCH /users/me."""
    resp = await client.patch(
        "/users/me",
        headers=user_headers,
        json={"email": "changed@example.com"},
    )
    # Section 4.3: email is not updatable via this endpoint.
    # Pydantic schema (UserUpdate) should ignore or reject the email field.
    # Either the field is silently ignored (200, same email) or rejected (400/422).
    if resp.status_code == 200:
        assert resp.json()["email"] == registered_user["email"]
    else:
        assert resp.status_code in (400, 422)


async def test_update_me_password_too_short_returns_400(
    client, registered_user, user_headers
):
    """Section 4.3 / 7.4: password < 8 chars via PATCH -> 400."""
    resp = await client.patch(
        "/users/me",
        headers=user_headers,
        json={"password": "1234567"},  # 7 chars
    )
    assert resp.status_code == 400


async def test_update_me_without_jwt_returns_401(client):
    """Section 9.5: no JWT on PATCH -> 401."""
    resp = await client.patch("/users/me", json={"display_name": "X"})
    assert resp.status_code == 401


async def test_update_me_with_invalid_jwt_returns_401(client):
    """Section 9.5: invalid JWT on PATCH -> 401."""
    resp = await client.patch(
        "/users/me",
        headers={"Authorization": "Bearer invalid-token"},
        json={"display_name": "X"},
    )
    assert resp.status_code == 401
