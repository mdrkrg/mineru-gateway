"""Email identity is ``lower(email)`` while storage keeps the original case.

fastapi-users looks users up with ``lower(email)``, so every owner lookup must
agree with login (the admin plane used to compare the raw string and 404).

Spec: specs/task-ownership.md §3 (credential issuance for an existing owner).
"""

from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from mineru_gateway.models import User

MIXED = "Owner@Example.COM"
FOLDED = "owner@example.com"
PASSWORD = "Sup3rSecret!"


async def _register(client, email: str, password: str = PASSWORD):
    return await client.post(
        "/auth/register", json={"email": email, "password": password}
    )


async def _login(client, email: str, password: str = PASSWORD):
    return await client.post(
        "/auth/jwt/login", json={"email": email, "password": password}
    )


async def test_stored_email_keeps_local_part_and_folds_domain(client):
    """A display value is preserved; only the domain is canonicalized."""
    resp = await _register(client, MIXED)
    assert resp.status_code == 201, resp.text
    assert resp.json()["email"] == "Owner@example.com"


@pytest.mark.parametrize("variant", [FOLDED, "OWNER@example.com", "Owner@EXAMPLE.COM"])
async def test_register_rejects_case_variants(client, variant):
    """A second account for the same identity is refused, whatever its case."""
    assert (await _register(client, "Owner@example.com")).status_code == 201
    resp = await _register(client, variant)
    assert resp.status_code == 400, resp.text
    assert "already registered" in resp.text.lower()


@pytest.mark.parametrize("variant", [FOLDED, "OWNER@example.com", "Owner@EXAMPLE.COM"])
async def test_login_accepts_case_variants(client, variant):
    """Login matches on lower(email), matching the framework's query."""
    assert (await _register(client, "Owner@example.com")).status_code == 201
    resp = await _login(client, variant)
    assert resp.status_code == 200, resp.text
    assert resp.json()["access_token"]


@pytest.mark.parametrize("variant", [FOLDED, "OWNER@example.com", "Owner@EXAMPLE.COM"])
async def test_admin_key_issuance_accepts_case_variants(client, admin_headers, variant):
    """``POST /auth/keys`` resolves the owner like login does, not verbatim.

    Regression: an exact-match lookup answered 404 for the very owner whose
    credentials login had just accepted.
    """
    assert (await _register(client, "Owner@example.com")).status_code == 201
    resp = await client.post(
        "/auth/keys", headers=admin_headers, json={"email": variant, "label": "ci"}
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["owner_email"] == "Owner@example.com"
    assert body["api_key"].startswith("mru_")


@pytest.mark.parametrize("variant", [FOLDED, "OWNER@example.com", "Owner@EXAMPLE.COM"])
async def test_unique_index_rejects_case_variant_rows(client, app, variant):
    """The invariant lives in the database, not only in the register handler.

    Even a write path that skips ``UserManager.create`` cannot add a second row.
    """
    assert (await _register(client, "Owner@example.com")).status_code == 201
    async with app.state.db.session_factory() as session:
        session.add(
            User(
                email=variant,
                hashed_password="x",
                is_active=True,
                is_verified=False,
                is_superuser=False,
            )
        )
        with pytest.raises(IntegrityError):
            await session.commit()
