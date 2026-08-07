"""Email verification route integration tests.

Spec: email-verification.md
  Section 4.1 - POST /auth/request-verify-token (send hook)
  Section 4.3 - GET /auth/verify (custom email-link endpoint)
  Section 8.3 - request-verify-token test points
  Section 8.5 - GET /auth/verify test points

POST /auth/request-verify-token and POST /auth/verify are provided by the
fastapi-users verify router; their library behaviors (202 anti-enumeration
matrix, token validation 400s) are out of scope per the spec Section 8
preamble and are not tested here. Only our integration points are covered:
the send hook, route registration, and the custom GET /auth/verify endpoint
(Section 4.3).
"""

from __future__ import annotations

from fastapi_users.jwt import generate_jwt
from fastapi_users.manager import VERIFY_USER_TOKEN_AUDIENCE


def _make_token(
    settings, user_id: str, email: str, lifetime_seconds: int = 3600
) -> str:
    """Build a verification token like fastapi-users request_verify does
    (spec Section 5.3: verification_token_secret = jwt_secret)."""
    return generate_jwt(
        {
            "sub": str(user_id),
            "email": email,
            "aud": VERIFY_USER_TOKEN_AUDIENCE,
        },
        settings.jwt_secret,
        lifetime_seconds,
    )


async def _register(client, email: str = "routes-user@example.com") -> dict:
    """Register a user and return the UserRead body."""
    resp = await client.post(
        "/auth/register",
        json={"email": email, "password": "secret123", "display_name": "Routes"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ===== Section 4.1 / 8.3: POST /auth/request-verify-token =====


async def test_request_verify_token_triggers_send_for_unverified_user(
    smtp_client, email_sender
):
    """Section 8.3: unverified user + SMTP configured -> route registered and
    a verification email is sent to the requesting address."""
    user = await _register(smtp_client)
    email_sender.reset()

    resp = await smtp_client.post(
        "/auth/request-verify-token", json={"email": user["email"]}
    )
    assert resp.status_code == 202
    assert len(email_sender.sent) == 1
    assert email_sender.sent[0]["user_email"] == user["email"]
    assert email_sender.sent[0]["token"]


async def test_request_verify_token_send_failure_does_not_break_202(
    smtp_client, email_sender
):
    """Section 4.4 / 7: a send failure is logged and does not break the flow
    -> request-verify-token still 202."""
    user = await _register(smtp_client)
    email_sender.reset()
    email_sender.raise_error = RuntimeError("smtp down")

    resp = await smtp_client.post(
        "/auth/request-verify-token", json={"email": user["email"]}
    )
    assert resp.status_code == 202


async def test_request_verify_token_404_without_smtp(client):
    """Section 8.3 / 1: SMTP not configured -> route not registered -> 404."""
    resp = await client.post(
        "/auth/request-verify-token", json={"email": "x@example.com"}
    )
    assert resp.status_code == 404


# ===== Section 4.3 / 8.5: GET /auth/verify?token= =====


async def test_verify_get_valid_token_returns_200_userread(smtp_client, email_sender):
    """Section 8.5: valid token, no redirect URL -> 200 + UserRead with
    is_verified=true."""
    user = await _register(smtp_client)
    resp = await smtp_client.get(f"/auth/verify?token={email_sender.last()['token']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == user["email"]
    assert body["is_verified"] is True


async def test_verify_get_valid_token_redirects_302_true(redirect_client, email_sender):
    """Section 8.5: valid token + redirect URL -> 302 to
    {oauth_frontend_redirect_url}#verified=true."""
    await _register(redirect_client)
    resp = await redirect_client.get(
        f"/auth/verify?token={email_sender.last()['token']}"
    )
    assert resp.status_code == 302
    assert (
        resp.headers["location"]
        == "https://frontend.example.com/callback#verified=true"
    )


async def test_verify_get_valid_token_redirects_302_true_with_query_string(
    redirect_query_client, email_sender
):
    """Section 4.3 / 8.5: valid token + redirect URL that already carries a
    query string -> 302, fragment appended after the query string."""
    await _register(redirect_query_client)
    resp = await redirect_query_client.get(
        f"/auth/verify?token={email_sender.last()['token']}"
    )
    assert resp.status_code == 302
    assert (
        resp.headers["location"]
        == "https://frontend.example.com/callback?from=email#verified=true"
    )


async def test_verify_get_invalid_token_no_redirect_returns_400(smtp_client):
    """Section 8.5: invalid token, no redirect URL -> 400."""
    resp = await smtp_client.get("/auth/verify?token=garbage-token")
    assert resp.status_code == 400


async def test_verify_get_invalid_token_redirects_302_false(redirect_client):
    """Section 8.5: invalid token + redirect URL -> 302 to
    {oauth_frontend_redirect_url}#verified=false."""
    resp = await redirect_client.get("/auth/verify?token=garbage-token")
    assert resp.status_code == 302
    assert (
        resp.headers["location"]
        == "https://frontend.example.com/callback#verified=false"
    )


async def test_verify_get_invalid_token_redirects_302_false_with_query_string(
    redirect_query_client,
):
    """Section 4.3 / 8.5: invalid token + redirect URL with a query string ->
    302, fragment appended after the query string."""
    resp = await redirect_query_client.get("/auth/verify?token=garbage-token")
    assert resp.status_code == 302
    assert (
        resp.headers["location"]
        == "https://frontend.example.com/callback?from=email#verified=false"
    )


async def test_verify_get_expired_token_no_redirect_returns_400(
    smtp_app, smtp_client, email_sender
):
    """Section 8.5: expired token, no redirect URL -> 400."""
    user = await _register(smtp_client)
    expired = _make_token(
        smtp_app.state.settings, user["id"], user["email"], lifetime_seconds=-10
    )
    resp = await smtp_client.get(f"/auth/verify?token={expired}")
    assert resp.status_code == 400


async def test_verify_get_expired_token_redirects_302_false(
    redirect_app, redirect_client, email_sender
):
    """Section 8.5: expired token + redirect URL -> 302 #verified=false."""
    user = await _register(redirect_client)
    expired = _make_token(
        redirect_app.state.settings, user["id"], user["email"], lifetime_seconds=-10
    )
    resp = await redirect_client.get(f"/auth/verify?token={expired}")
    assert resp.status_code == 302
    assert (
        resp.headers["location"]
        == "https://frontend.example.com/callback#verified=false"
    )


async def test_verify_get_already_verified_user_no_redirect_returns_400(
    smtp_client, email_sender
):
    """Section 8.5: user already verified, no redirect URL -> 400."""
    await _register(smtp_client)
    token = email_sender.last()["token"]
    first = await smtp_client.get(f"/auth/verify?token={token}")
    assert first.status_code == 200
    second = await smtp_client.get(f"/auth/verify?token={token}")
    assert second.status_code == 400


async def test_verify_get_already_verified_user_redirects_302_false(
    redirect_client, email_sender
):
    """Section 8.5: user already verified + redirect URL -> 302 #verified=false."""
    await _register(redirect_client)
    token = email_sender.last()["token"]
    first = await redirect_client.get(f"/auth/verify?token={token}")
    assert first.status_code == 302
    assert (
        first.headers["location"]
        == "https://frontend.example.com/callback#verified=true"
    )
    second = await redirect_client.get(f"/auth/verify?token={token}")
    assert second.status_code == 302
    assert (
        second.headers["location"]
        == "https://frontend.example.com/callback#verified=false"
    )
