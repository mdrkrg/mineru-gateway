"""OIDC client lookup (Section 5.2).

Spec: user-management-and-oauth.md Section 5.2 (get_oauth_client).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from httpx_oauth.clients.openid import OpenID

from httpx_oauth.oauth2 import BaseOAuth2

from ...config import OIDCProviderConfig, Settings


class ManualOIDCClient(BaseOAuth2[dict[str, Any]]):
    """OIDC client for Mode B (manual endpoints, no discovery).

    Constructed with explicit authorization_endpoint, token_endpoint,
    and userinfo_endpoint instead of fetching a discovery document.
    """

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        authorize_endpoint: str,
        access_token_endpoint: str,
        userinfo_endpoint: str | None = None,
        refresh_token_endpoint: str | None = None,
        name: str = "openid",
        base_scopes: list[str] | None = None,
    ):
        self.userinfo_endpoint = userinfo_endpoint
        super().__init__(
            client_id=client_id,
            client_secret=client_secret,
            authorize_endpoint=authorize_endpoint,
            access_token_endpoint=access_token_endpoint,
            refresh_token_endpoint=refresh_token_endpoint or access_token_endpoint,
            name=name,
            base_scopes=base_scopes,
        )

    async def get_profile(self, token: str) -> dict[str, Any]:
        if not self.userinfo_endpoint:
            return {}
        from httpx_oauth.exceptions import GetProfileError

        async with self.get_httpx_client() as client:
            response = await client.get(
                self.userinfo_endpoint,
                headers={**self.request_headers, "Authorization": f"Bearer {token}"},
            )
            if response.status_code >= 400:
                raise GetProfileError(response=response)
            return response.json()

    async def get_id_email(self, token: str) -> tuple[str, str | None]:
        from httpx_oauth.exceptions import GetIdEmailError, GetProfileError

        try:
            profile = await self.get_profile(token)
        except GetProfileError as e:
            raise GetIdEmailError(response=e.response) from e
        return str(profile["sub"]), profile.get("email")


def _build_oauth_client(provider: OIDCProviderConfig) -> OpenID | ManualOIDCClient:
    """Construct the OIDC client for a provider configuration.

    ``OpenID`` performs the discovery request synchronously in its
    constructor, so this must only be called on a cache miss.
    """
    from httpx_oauth.clients.openid import OpenID

    if provider.openid_configuration_endpoint:
        return OpenID(
            openid_configuration_endpoint=provider.openid_configuration_endpoint,
            client_id=provider.client_id,
            client_secret=provider.client_secret,
            base_scopes=provider.scopes,
        )

    return ManualOIDCClient(
        client_id=provider.client_id,
        client_secret=provider.client_secret,
        authorize_endpoint=provider.authorization_endpoint,  # type: ignore[arg-type]
        access_token_endpoint=provider.token_endpoint,  # type: ignore[arg-type]
        userinfo_endpoint=provider.userinfo_endpoint,
        name=provider.name,
        base_scopes=provider.scopes,
    )


# ``OpenID.__init__`` issues a synchronous OIDC discovery request, so building a
# client per request would block the event loop (single worker) and re-fetch the
# discovery document; clients are therefore cached per provider, per app.


def get_oauth_client(
    name: str,
    settings: Settings,
    cache: dict[str, OpenID | ManualOIDCClient],
) -> OpenID | ManualOIDCClient | None:
    """Section 5.2: lookup OIDC client by provider name in settings.

    Returns None if provider not found. ``cache`` is ``app.state.oauth_clients``;
    it is filled lazily so an unreachable provider cannot fail app startup.
    """
    for provider in settings.oidc_providers:
        if provider.name == name:
            client = cache.get(name)
            if client is None:
                client = _build_oauth_client(provider)
                cache[name] = client
            return client
    return None
