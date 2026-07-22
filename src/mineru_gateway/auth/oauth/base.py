"""OIDC client lookup (Section 5.2).

Spec: user-management-and-oauth.md Section 5.2 (get_oauth_client).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from httpx_oauth.clients.openid import OpenID

from ...config import get_settings


def get_oauth_client(name: str) -> OpenID | None:
    """Section 5.2: lookup OIDC client by provider name in config.

    Returns None if provider not found.
    """
    from httpx_oauth.clients.openid import OpenID

    settings = get_settings()
    for provider in settings.oidc_providers:
        if provider.name == name:
            return OpenID(
                openid_configuration_endpoint=provider.openid_configuration_endpoint,
                client_id=provider.client_id,
                client_secret=provider.client_secret,
            )
    return None
