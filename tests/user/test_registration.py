"""Tests for user registration and admin user creation.

Spec: user-management-and-oauth.md
  Section 4.2 - registration endpoint, admin create user
  Section 9.1 - registration test points
  Section 7.4 - password rules (min 8 chars, must not contain email)
"""

from __future__ import annotations

import pytest


# ===== Section 4.2 / 9.1: POST /auth/register (public registration) =====


async def test_register_success_returns_201(client):
    """Section 4.2: register with valid email + password -> 201 + UserRead."""
    resp = await client.post(
        "/auth/register",
        json={
            "email": "alice@example.com",
            "password": "secret123",
            "display_name": "Alice",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["email"] == "alice@example.com"
    assert body["display_name"] == "Alice"
    assert body["is_active"] is True
    assert body["is_superuser"] is False
    assert body["is_verified"] is False
    assert "id" in body
    assert "created_at" in body
    assert "updated_at" in body
    # Section 4.2: does NOT auto-issue tokens
    assert "access_token" not in body
    assert "refresh_token" not in body


async def test_register_duplicate_email_returns_400(client):
    """Section 9.1: duplicate email -> 400."""
    payload = {
        "email": "dup@example.com",
        "password": "secret123",
        "display_name": "Dup",
    }
    first = await client.post("/auth/register", json=payload)
    assert first.status_code == 201

    second = await client.post("/auth/register", json=payload)
    assert second.status_code == 400


async def test_register_password_too_short_returns_400(client):
    """Section 9.1 / 7.4: password < 8 chars -> 400."""
    resp = await client.post(
        "/auth/register",
        json={
            "email": "short@example.com",
            "password": "1234567",  # 7 chars
            "display_name": "Short",
        },
    )
    assert resp.status_code == 400


async def test_register_password_contains_email_returns_400(client):
    """Section 9.1 / 7.4: password containing email -> 400."""
    resp = await client.post(
        "/auth/register",
        json={
            "email": "user@example.com",
            "password": "user@example.com123",
            "display_name": "Embed",
        },
    )
    assert resp.status_code == 400


async def test_register_closed_registration_returns_403(closed_reg_client):
    """Section 9.1 / 4.2: OPEN_REGISTRATION=false -> 403, no user created."""
    resp = await closed_reg_client.post(
        "/auth/register",
        json={
            "email": "nobody@example.com",
            "password": "secret123",
            "display_name": "Nobody",
        },
    )
    assert resp.status_code == 403

    # Spec 4.2: "不创建用户". Verify the rejected credentials cannot be used to
    # log in - a subsequent login attempt must fail with 401, confirming no
    # User row was persisted.
    login = await closed_reg_client.post(
        "/auth/jwt/login",
        json={"email": "nobody@example.com", "password": "secret123"},
    )
    assert login.status_code == 401


# ===== Section 4.2 / 9.1: POST /auth/users (admin create user) =====


async def test_admin_create_user_success(client, admin_headers):
    """Section 4.2: admin creates user -> 201 + UserRead."""
    resp = await client.post(
        "/auth/users",
        headers=admin_headers,
        json={
            "email": "bob@example.com",
            "password": "secret456",
            "display_name": "Bob",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["email"] == "bob@example.com"
    assert body["display_name"] == "Bob"
    assert body["is_active"] is True
    assert body["is_superuser"] is False
    assert body["is_verified"] is False
    assert "id" in body
    assert "created_at" in body
    assert "updated_at" in body
    assert "access_token" not in body
    assert "refresh_token" not in body


async def test_admin_create_user_not_affected_by_closed_registration(
    closed_reg_client, admin_headers
):
    """Section 4.2: admin create user works even when OPEN_REGISTRATION=false."""
    resp = await closed_reg_client.post(
        "/auth/users",
        headers=admin_headers,
        json={
            "email": "admin-created@example.com",
            "password": "secret123",
            "display_name": "Admin Created",
        },
    )
    assert resp.status_code == 201


async def test_admin_create_user_wrong_token_returns_401(client):
    """Section 9.1: invalid X-Admin-Token -> 401."""
    resp = await client.post(
        "/auth/users",
        headers={"X-Admin-Token": "wrong-token"},
        json={
            "email": "unauth@example.com",
            "password": "secret123",
            "display_name": "Unauth",
        },
    )
    assert resp.status_code == 401


async def test_admin_create_user_no_token_returns_401(client):
    """Section 9.1: missing X-Admin-Token -> 401."""
    resp = await client.post(
        "/auth/users",
        json={
            "email": "notoken@example.com",
            "password": "secret123",
            "display_name": "NoToken",
        },
    )
    assert resp.status_code == 401


async def test_admin_create_user_duplicate_email_returns_400(client, admin_headers):
    """Section 4.2: duplicate email via admin -> 400."""
    payload = {
        "email": "admin-dup@example.com",
        "password": "secret123",
        "display_name": "AdminDup",
    }
    first = await client.post("/auth/users", headers=admin_headers, json=payload)
    assert first.status_code == 201

    second = await client.post("/auth/users", headers=admin_headers, json=payload)
    assert second.status_code == 400


async def test_admin_create_user_bad_password_returns_400(client, admin_headers):
    """Section 4.2 / 7.4: weak password via admin -> 400."""
    resp = await client.post(
        "/auth/users",
        headers=admin_headers,
        json={
            "email": "weak@example.com",
            "password": "1234567",  # < 8 chars
            "display_name": "Weak",
        },
    )
    assert resp.status_code == 400


async def test_admin_create_user_password_contains_email_returns_400(
    client, admin_headers
):
    """Section 4.2 / 7.4: admin create with password containing email -> 400."""
    resp = await client.post(
        "/auth/users",
        headers=admin_headers,
        json={
            "email": "embed@example.com",
            "password": "embed@example.com123",
            "display_name": "Embed",
        },
    )
    assert resp.status_code == 400


# ===== Section 4.2: admin create honours privileged flags =====


@pytest.mark.parametrize("flag", ["is_superuser", "is_verified"])
async def test_admin_create_user_honours_privileged_flag(client, admin_headers, flag):
    """Section 4.2: POST /auth/users honours privileged flags (admin-token gated)."""
    resp = await client.post(
        "/auth/users",
        headers=admin_headers,
        json={
            "email": f"{flag}@example.com",
            "password": "secret123",
            "display_name": flag,
            flag: True,
        },
    )
    assert resp.status_code == 201
    assert resp.json()[flag] is True
