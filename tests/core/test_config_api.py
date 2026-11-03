"""GET /v1/config: unauthenticated capabilities a client reads at boot."""

from __future__ import annotations


async def test_config_reports_user_auth_enabled_without_credentials(
    client, key_only_client
):
    """No credential header: a client reads this before it has a key or JWT."""
    for http_client, expected in ((client, True), (key_only_client, False)):
        resp = await http_client.get("/v1/config")
        assert resp.status_code == 200
        assert resp.json() == {"user_auth_enabled": expected, "providers": []}
