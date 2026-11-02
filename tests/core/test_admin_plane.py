"""Admin plane: owner provisioning and key issuance.

Spec: specs/task-ownership.md §3 - owners are provisioned before credentials,
an owner without a password cannot sign in, and admin-issued keys are the same
object as self-service keys.
"""

from __future__ import annotations

import uuid

import pytest

from mineru_gateway.main import create_app
from mineru_gateway.models import User
from tests.conftest import ADMIN_TOKEN, create_key

ADMIN_HEADERS = {"X-Admin-Token": ADMIN_TOKEN}


async def test_key_only_deployment_can_bootstrap_credentials(
    key_only_client, sample_files
):
    """A key-only deployment can provision an owner and mint its first key."""
    created = await key_only_client.post(
        "/auth/users",
        headers=ADMIN_HEADERS,
        json={"email": "release-bot@example.com", "display_name": "CI pipeline"},
    )
    assert created.status_code == 201, created.text
    owner = created.json()
    assert owner["email"] == "release-bot@example.com"
    assert owner["is_verified"] is True
    assert owner["is_active"] is True

    issued = await key_only_client.post(
        "/auth/keys",
        headers=ADMIN_HEADERS,
        json={"email": "release-bot@example.com", "label": "ci"},
    )
    assert issued.status_code == 201, issued.text
    key = issued.json()
    assert key["owner_id"] == owner["id"]
    assert key["owner_email"] == "release-bot@example.com"

    submitted = await key_only_client.post(
        "/v1/tasks", headers={"X-API-Key": key["api_key"]}, files=sample_files
    )
    assert submitted.status_code == 202, submitted.text

    listed = await key_only_client.get(
        "/v1/tasks", headers={"X-API-Key": key["api_key"]}
    )
    assert listed.status_code == 200
    assert listed.json()["total"] == 1


async def test_rotation_reuses_the_owner_history(key_only_client, sample_files):
    """A second key for the same owner is the same tenant, not a new one."""
    await key_only_client.post(
        "/auth/users",
        headers=ADMIN_HEADERS,
        json={"email": "rotate@example.com"},
    )
    first = (
        await key_only_client.post(
            "/auth/keys",
            headers=ADMIN_HEADERS,
            json={"email": "rotate@example.com", "label": "old"},
        )
    ).json()
    submitted = await key_only_client.post(
        "/v1/tasks", headers={"X-API-Key": first["api_key"]}, files=sample_files
    )
    assert submitted.status_code == 202

    second = (
        await key_only_client.post(
            "/auth/keys",
            headers=ADMIN_HEADERS,
            json={"email": "rotate@example.com", "label": "new"},
        )
    ).json()
    assert second["owner_id"] == first["owner_id"]

    seen = await key_only_client.get(
        "/v1/tasks", headers={"X-API-Key": second["api_key"]}
    )
    assert seen.status_code == 200
    assert seen.json()["total"] == 1


async def test_owner_without_password_cannot_sign_in(client, admin_headers):
    """Credential-only owners exist to own tasks, not to log in."""
    created = await client.post(
        "/auth/users",
        headers=admin_headers,
        json={"email": "credential-only@example.com"},
    )
    assert created.status_code == 201

    login = await client.post(
        "/auth/jwt/login",
        json={"email": "credential-only@example.com", "password": "guessing123"},
    )
    assert login.status_code == 401


async def test_owner_with_password_can_sign_in(client, admin_headers):
    """Supplying a password provisions a normal login account instead."""
    created = await client.post(
        "/auth/users",
        headers=admin_headers,
        json={"email": "login-owner@example.com", "password": "secret123"},
    )
    assert created.status_code == 201
    assert created.json()["is_verified"] is False

    login = await client.post(
        "/auth/jwt/login",
        json={"email": "login-owner@example.com", "password": "secret123"},
    )
    assert login.status_code == 200
    assert login.json()["access_token"]


async def test_explicit_null_is_active_is_rejected(client, admin_headers):
    """`is_active` is a plain bool; only `is_verified` has a null sentinel."""
    resp = await client.post(
        "/auth/users",
        headers=admin_headers,
        json={"email": "null-flags@example.com", "is_active": None},
    )
    assert resp.status_code == 422


async def test_inactive_owner_credentials_are_rejected(key_only_client, sample_files):
    """A deactivated owner loses every credential it holds (spec §6)."""
    denied = await key_only_client.post(
        "/auth/users",
        headers=ADMIN_HEADERS,
        json={"email": "asleep@example.com", "is_active": False},
    )
    assert denied.status_code == 201
    assert (
        await key_only_client.post(
            "/auth/keys",
            headers=ADMIN_HEADERS,
            json={"email": "asleep@example.com"},
        )
    ).status_code == 409

    owner = (
        await key_only_client.post(
            "/auth/users",
            headers=ADMIN_HEADERS,
            json={"email": "sleepy@example.com"},
        )
    ).json()
    key = (
        await key_only_client.post(
            "/auth/keys",
            headers=ADMIN_HEADERS,
            json={"email": "sleepy@example.com"},
        )
    ).json()
    assert (
        await key_only_client.get("/v1/tasks", headers={"X-API-Key": key["api_key"]})
    ).status_code == 200

    async with key_only_client._transport.app.state.db.session_factory() as session:
        user = await session.get(User, uuid.UUID(owner["id"]))
        user.is_active = False
        await session.commit()

    rejected = await key_only_client.get(
        "/v1/tasks", headers={"X-API-Key": key["api_key"]}
    )
    assert rejected.status_code == 401


async def test_admin_key_equals_self_service_key(client, user_headers):
    """Both issuance paths produce the same object for the same owner."""
    me = await client.get("/users/me", headers=user_headers)
    assert me.status_code == 200
    email = me.json()["email"]

    delegated = (await create_key(client, label="delegated", email=email)).json()
    mine = await client.post(
        "/me/api-keys", json={"label": "mine"}, headers=user_headers
    )
    assert mine.status_code == 201, mine.text

    admin_view = await client.get("/auth/keys", headers={"X-Admin-Token": ADMIN_TOKEN})
    assert admin_view.status_code == 200
    entries = [k for k in admin_view.json()["keys"] if k["owner_id"] == me.json()["id"]]
    assert {e["id"] for e in entries} == {delegated["key_id"], mine.json()["key_id"]}
    assert {e["owner_email"] for e in entries} == {email}


async def test_admin_plane_rejects_the_default_admin_token(settings):
    """The admin plane mints identities, so the placeholder token fails closed."""
    with pytest.raises(ValueError, match="GATEWAY_ADMIN_TOKEN"):
        create_app(settings=settings.model_copy(update={"admin_token": "change-me"}))
