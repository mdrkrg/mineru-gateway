"""Point OIDC client lookups at the mock client in user/OAuth tests."""

from __future__ import annotations

from typing import Any

import pytest

from mineru_gateway.auth.oauth import base


def patch_oauth(
    monkeypatch: pytest.MonkeyPatch,
    mock_oauth_client: Any,
    providers: tuple[str, ...] = ("keycloak",),
) -> None:
    """Replace ``get_oauth_client`` with a mock for the given providers."""
    monkeypatch.setattr(
        base,
        "get_oauth_client",
        lambda name, _settings, _cache: (
            mock_oauth_client if name in providers else None
        ),
    )
