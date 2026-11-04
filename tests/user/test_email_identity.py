"""Email identity is ``lower(email)`` while storage keeps the original case.

fastapi-users looks users up with ``lower(email)``, so every owner lookup must
agree with login (the admin plane used to compare the raw string and 404).

Spec: specs/task-ownership.md §3 (credential issuance for an existing owner).
"""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from mineru_gateway.models import User
from mineru_gateway.utils.email import AsciiEmail

MIXED = "Owner@Example.COM"
FOLDED = "owner@example.com"
UPPER = "OWNER@example.com"
PASSWORD = "Sup3rSecret!"


async def _register(client, email: str):
    return await client.post(
        "/auth/register", json={"email": email, "password": PASSWORD}
    )


async def _login(client, email: str):
    return await client.post(
        "/auth/jwt/login", json={"email": email, "password": PASSWORD}
    )


async def test_case_folding_agrees_across_register_login_and_admin_lookup(
    client, admin_headers
):
    """One identity, three entry points: register, login, admin key issuance.

    Regression: ``POST /auth/keys`` compared the raw string and answered 404
    for the very owner whose credentials login had just accepted.
    """
    registered = await _register(client, MIXED)
    assert registered.status_code == 201, registered.text
    # The local part keeps its case for display.
    assert registered.json()["email"].split("@")[0] == "Owner"

    login = await _login(client, FOLDED)
    assert login.status_code == 200, login.text
    assert login.json()["access_token"]

    issued = await client.post(
        "/auth/keys", headers=admin_headers, json={"email": UPPER, "label": "ci"}
    )
    assert issued.status_code == 201, issued.text
    assert issued.json()["owner_email"] == "Owner@example.com"


async def test_register_rejects_a_case_variant_of_an_existing_identity(client):
    """A second account for the same identity is refused, whatever its case."""
    assert (await _register(client, MIXED)).status_code == 201
    resp = await _register(client, FOLDED)
    assert resp.status_code == 400, resp.text
    assert "already registered" in resp.text.lower()


async def test_unique_index_rejects_a_case_variant_written_outside_the_api(client, app):
    """The invariant lives in the database, not only in the register handler.

    Even a write path that skips ``UserManager.create`` cannot add a second row.
    """
    assert (await _register(client, MIXED)).status_code == 201
    async with app.state.db.session_factory() as session:
        session.add(
            User(
                email=UPPER,
                hashed_password="x",
                is_active=True,
                is_verified=False,
                is_superuser=False,
            )
        )
        with pytest.raises(IntegrityError):
            await session.commit()


# ===== Canonical ASCII addresses: one identity on every backend =====
#
# Identity is SQL ``lower(email)``, and SQL folding of non-ASCII depends on the
# database build, so ``AsciiEmail`` downgrades IDN domains to punycode and
# refuses local parts that would need SMTPUTF8.

_ASCII_EMAIL = TypeAdapter(AsciiEmail)


@pytest.mark.parametrize("value", ["Ärger@example.com", "İ@example.com"])
def test_ascii_email_rejects_smtputf8_local_parts(value):
    """A non-ASCII local part has no portable case-insensitive identity."""
    with pytest.raises(ValidationError, match="ASCII"):
        _ASCII_EMAIL.validate_python(value)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("Owner@Example.COM", "Owner@example.com"),
        ("user@münchen.de", "user@xn--mnchen-3ya.de"),
        ("USER@MÜNCHEN.DE", "USER@xn--mnchen-3ya.de"),
    ],
)
def test_ascii_email_downgrades_idn_domains_to_punycode(value, expected):
    """IDN domains are supported; only the domain is rewritten."""
    assert _ASCII_EMAIL.validate_python(value) == expected


async def test_register_rejects_a_smtputf8_address(client):
    """The public registration schema carries the rule end to end."""
    resp = await _register(client, "Ärger@example.com")
    assert resp.status_code == 422, resp.text
    assert "ASCII" in resp.text


async def test_idn_domain_registers_and_logs_in_under_one_punycode_identity(
    client, app, admin_headers
):
    """An IDN domain is stored as punycode and matched from either spelling."""
    registered = await _register(client, "user@münchen.de")
    assert registered.status_code == 201, registered.text
    # The API still shows the address the user typed; identity is punycode.
    assert registered.json()["email"] == "user@münchen.de"

    async with app.state.db.session_factory() as session:
        stored = (await session.execute(select(User.email))).scalars().one()
    assert stored == "user@xn--mnchen-3ya.de"

    for spelling in ("user@münchen.de", "USER@MÜNCHEN.DE", "user@xn--mnchen-3ya.de"):
        login = await _login(client, spelling)
        assert login.status_code == 200, (spelling, login.text)

    issued = await client.post(
        "/auth/keys",
        headers=admin_headers,
        json={"email": "user@münchen.de", "label": "ci"},
    )
    assert issued.status_code == 201, issued.text


async def test_admin_create_rejects_a_smtputf8_address(client, admin_headers):
    """The admin user schema is a plain BaseModel and needs the same field."""
    resp = await client.post(
        "/auth/users",
        headers=admin_headers,
        json={"email": "Ärger@example.com"},
    )
    assert resp.status_code == 422, resp.text


async def test_admin_key_issuance_rejects_a_smtputf8_address(client, admin_headers):
    """``POST /auth/keys`` looks owners up by lower(email), so it shares the rule."""
    resp = await client.post(
        "/auth/keys",
        headers=admin_headers,
        json={"email": "Ärger@example.com", "label": "ci"},
    )
    assert resp.status_code == 422, resp.text
