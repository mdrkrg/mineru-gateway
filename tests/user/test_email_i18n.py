"""Verification email i18n: file templates and locale-parameter resolution.

Spec: email-verification.md
  Section 4.4 - email content (HTML template, <a> link, locale resolution)
  Section 5.2 - send_verification_email signature (locale)
"""

from __future__ import annotations

import pytest

from mineru_gateway.email import service as email_service

VERIFY_URL = "https://gw.example.com/auth/verify?token=tok"
EN_SUBJECT = "Verify your email address"
ZH_CN_SUBJECT = "验证您的邮箱地址"

# ===== Locale resolution (spec Section 4.4) =====


@pytest.mark.parametrize(
    ("requested", "expected"),
    [
        ("zh-CN", "zh-CN"),
        ("zh-cn", "zh-CN"),
        ("en", "en"),
        ("zh-TW", "zh-CN"),
        ("zh", "zh-CN"),
        (None, "en"),
        ("", "en"),
        ("fr", "en"),
        ("../../etc/passwd", "en"),
    ],
)
def test_resolve_locale(requested, expected):
    """Exact (case-insensitive) tag wins, then base language, else the `en`
    fallback, including for malformed or hostile values."""
    assert email_service.resolve_locale(requested) == expected


# ===== Template rendering (files under email/templates/) =====


@pytest.mark.parametrize(
    ("locale", "lifetime", "subject", "expiry"),
    [
        ("en", 3600, EN_SUBJECT, "1 hour"),
        ("zh-CN", 3600, ZH_CN_SUBJECT, "1 小时"),
        ("en", 1800, EN_SUBJECT, "30 minutes"),
    ],
    ids=["en-hours", "zh-CN-hours", "en-minutes"],
)
def test_render_verification_email(locale, lifetime, subject, expiry):
    """Each shipped locale renders its own subject, an HTML ``<a>`` CTA and a
    plain-text link with the human-readable expiry."""
    rendered_subject, plain, html = email_service.render_verification_email(
        locale, verify_url=VERIFY_URL, lifetime_seconds=lifetime
    )
    assert rendered_subject == subject
    assert f'<a href="{VERIFY_URL}"' in html
    assert expiry in plain


# ===== send_verification_email hands the rendered body to fastapi-mail =====


@pytest.fixture
def captured_messages(monkeypatch):
    """Capture the MessageSchema objects passed to fastapi-mail (no SMTP)."""
    sent: list = []

    class _FakeFastMail:
        def __init__(self, conf) -> None:
            pass

        async def send_message(self, message) -> None:
            sent.append(message)

    monkeypatch.setattr(email_service, "FastMail", _FakeFastMail)
    return sent


async def test_send_verification_email_uses_localized_content(
    captured_messages, smtp_settings
):
    """The resolved locale drives the subject, and the rendered link (not the
    old hardcoded text) reaches the message body."""
    await email_service.send_verification_email(
        "i18n@example.com", "tok-123", smtp_settings, locale="zh-CN"
    )
    assert len(captured_messages) == 1
    assert captured_messages[0].subject == ZH_CN_SUBJECT
    assert "/auth/verify?token=tok-123" in (captured_messages[0].body or "")


# ===== Manager forwards the request's locale parameter =====


@pytest.mark.parametrize(
    ("query", "expected"),
    [("?locale=zh-CN", "zh-CN"), ("", None), ("?locale=xx-YY", "xx-YY")],
    ids=["known", "absent", "unknown"],
)
async def test_register_forwards_locale(smtp_client, email_sender, query, expected):
    """Register passes the raw ``locale`` query through unchanged: resolution
    (and the ``en`` fallback) belongs to the sender, so an unknown tag must
    not break registration."""
    resp = await smtp_client.post(
        f"/auth/register{query}",
        json={"email": "locale-user@example.com", "password": "secret123"},
    )
    assert resp.status_code == 201, resp.text
    assert email_sender.sent[0]["locale"] == expected


async def test_request_verify_token_forwards_locale(smtp_client, email_sender):
    """The resend route forwards the SPA's ``locale`` query the same way."""
    reg = await smtp_client.post(
        "/auth/register",
        json={"email": "resend-locale@example.com", "password": "secret123"},
    )
    assert reg.status_code == 201
    email_sender.reset()

    resp = await smtp_client.post(
        "/auth/request-verify-token?locale=zh-CN",
        json={"email": "resend-locale@example.com"},
    )
    assert resp.status_code == 202
    assert email_sender.sent[0]["locale"] == "zh-CN"
