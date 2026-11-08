"""Shared helpers for the user-auth suites.

The OAuth tests all drive the same provider dance, and the linking tests all
need a verified local owner; one implementation each avoids a copy per module.

Spec: user-management-and-oauth.md Sections 4.5, 9.7.
"""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

from httpx import AsyncClient, Response

from mineru_gateway.config import OIDCProviderConfig, Settings
from tests.conftest import ADMIN_TOKEN

# The provider every OAuth suite drives; suites override fields as needed.
KEYCLOAK_PROVIDER = OIDCProviderConfig(
    name="keycloak",
    openid_configuration_endpoint=(
        "https://keycloak.example.com/.well-known/openid-configuration"
    ),
    client_id="test-client-id",
    client_secret="test-client-secret",
)


async def oauth_flow(client: AsyncClient, code: str = "test-code") -> Response:
    """Drive authorize -> callback against the ``keycloak`` provider."""
    auth_resp = await client.get("/auth/oauth/keycloak/authorize")
    assert auth_resp.status_code == 302, auth_resp.text

    location = auth_resp.headers.get("location", "")
    state = parse_qs(urlparse(location).query).get("state", [""])[0]

    return await client.get(f"/auth/oauth/keycloak/callback?code={code}&state={state}")


async def provision_owner(
    client: AsyncClient,
    email: str,
    *,
    password: str = "secret123",
    display_name: str | None = None,
    is_verified: bool | None = None,
) -> dict:
    """Create a local owner through the admin plane.

    Association tests need a verified row, and open registration cannot run
    without SMTP when OIDC is configured.
    """
    payload: dict = {"email": email, "password": password}
    if display_name is not None:
        payload["display_name"] = display_name
    if is_verified is not None:
        payload["is_verified"] = is_verified
    resp = await client.post(
        "/auth/users", json=payload, headers={"X-Admin-Token": ADMIN_TOKEN}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def oidc_settings(settings: Settings, *providers: OIDCProviderConfig) -> Settings:
    """Settings for an OIDC suite running without SMTP (registration closed).

    A provider plus open registration and no mailbox flow is refused at startup.
    """
    return settings.model_copy(
        update={
            "oidc_providers": list(providers),
            "oauth_redirect_base_url": "http://testserver",
            "open_registration": False,
        }
    )
