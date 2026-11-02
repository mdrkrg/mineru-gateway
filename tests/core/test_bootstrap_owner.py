"""GATEWAY_BOOTSTRAP_OWNER_EMAIL: seed the first owner for key-only deployments.

Spec: specs/task-ownership.md §3 - the seed is idempotent and never modifies an
existing account.
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

import httpx
import pytest
from asgi_lifespan import LifespanManager
from sqlalchemy import select

from mineru_gateway.config import Settings
from mineru_gateway.main import create_app
from mineru_gateway.models import User
from tests.conftest import ADMIN_TOKEN

ADMIN_HEADERS = {"X-Admin-Token": ADMIN_TOKEN}
BOOTSTRAP_EMAIL = "bootstrap-owner@example.com"


@asynccontextmanager
async def _client_for(settings, upstream_client):
    application = create_app(settings=settings, upstream_client=upstream_client)
    async with LifespanManager(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            yield application, client


@pytest.fixture
def bootstrap_settings(settings):
    return settings.model_copy(
        update={
            "user_auth_enabled": False,
            "bootstrap_owner_email": BOOTSTRAP_EMAIL,
        }
    )


async def test_bootstrap_owner_lets_a_key_only_deployment_issue_keys(
    bootstrap_settings, upstream_client
):
    async with _client_for(bootstrap_settings, upstream_client) as (_, client):
        issued = await client.post(
            "/auth/keys",
            headers=ADMIN_HEADERS,
            json={"email": BOOTSTRAP_EMAIL, "label": "ci"},
        )
        assert issued.status_code == 201, issued.text
        key = issued.json()
        assert key["owner_email"] == BOOTSTRAP_EMAIL

        listed = await client.get("/v1/tasks", headers={"X-API-Key": key["api_key"]})
        assert listed.status_code == 200
        assert listed.json()["total"] == 0


async def test_bootstrap_owner_is_created_once(bootstrap_settings, upstream_client):
    async with _client_for(bootstrap_settings, upstream_client) as (app, _):
        async with app.state.db.session_factory() as session:
            first = (await session.execute(select(User))).scalars().one()

    async with _client_for(bootstrap_settings, upstream_client) as (app, _):
        async with app.state.db.session_factory() as session:
            second = (await session.execute(select(User))).scalars().one()

    # The second boot skipped the seed instead of re-inserting or rewriting.
    assert second.id == first.id
    assert second.hashed_password == first.hashed_password


async def test_bootstrap_owner_leaves_an_existing_account_untouched(
    settings, upstream_client
):
    async with _client_for(settings, upstream_client) as (app, client):
        registered = await client.post(
            "/auth/register",
            json={"email": BOOTSTRAP_EMAIL, "password": "secret123"},
        )
        assert registered.status_code == 201
        assert registered.json()["is_verified"] is False
        owner_id = uuid.UUID(registered.json()["id"])
        async with app.state.db.session_factory() as session:
            before = (await session.get(User, owner_id)).hashed_password

    seeded = settings.model_copy(update={"bootstrap_owner_email": BOOTSTRAP_EMAIL})
    async with _client_for(seeded, upstream_client) as (app, client):
        async with app.state.db.session_factory() as session:
            after = await session.get(User, owner_id)
        login = await client.post(
            "/auth/jwt/login",
            json={"email": BOOTSTRAP_EMAIL, "password": "secret123"},
        )
        assert login.status_code == 200
        assert login.json()["access_token"]

    assert after.hashed_password == before
    assert after.is_verified is False
    assert after.is_active is True


def test_bootstrap_owner_email_is_optional(monkeypatch):
    # A copied .env carries the key with an empty value; it must mean "unset".
    monkeypatch.setenv("GATEWAY_BOOTSTRAP_OWNER_EMAIL", "")
    assert Settings().bootstrap_owner_email is None
    assert Settings(bootstrap_owner_email="  ").bootstrap_owner_email is None
    with pytest.raises(ValueError):
        Settings(bootstrap_owner_email="not-an-email")
