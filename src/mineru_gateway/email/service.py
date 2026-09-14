"""SMTP email sending via fastapi-mail (spec: email-verification.md Section 5.2).

Per-locale Jinja2 templates live in ``templates/`` as
``verify_email.{locale}.{subject.txt,txt,html}``; adding a locale is dropping
three files in, no code change. ``resolve_locale`` picks the set and falls
back to ``en``. ``send_verification_email`` is the seam tests replace so no
real SMTP connection is made.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

from fastapi_mail import (
    ConnectionConfig,
    FastMail,
    MessageSchema,
    MessageType,
    MultipartSubtypeEnum,
)
from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import SecretStr

from ..config import Settings

logger = logging.getLogger(__name__)

_TEMPLATES_DIR = Path(__file__).parent / "templates"
_TEMPLATE_STEM = "verify_email"
_FALLBACK_LOCALE = "en"


@lru_cache(maxsize=1)
def _jinja_env() -> Environment:
    """Jinja2 environment over the packaged template directory.

    Jinja caches compiled templates after the first load, so per-send cost is
    a cache-hit render; HTML files are autoescaped, txt files are not.
    """
    return Environment(
        loader=FileSystemLoader(str(_TEMPLATES_DIR)),
        autoescape=select_autoescape(enabled_extensions=("html",), default=False),
        trim_blocks=True,
        lstrip_blocks=True,
    )


@lru_cache(maxsize=1)
def available_locales() -> tuple[str, ...]:
    """Locales shipping a full template set, sorted for deterministic picks."""
    return tuple(
        sorted(
            path.name.removeprefix(f"{_TEMPLATE_STEM}.").removesuffix(".html")
            for path in _TEMPLATES_DIR.glob(f"{_TEMPLATE_STEM}.*.html")
        )
    )


def resolve_locale(locale: str | None = None) -> str:
    """Pick the template locale for ``locale``.

    Exact (case-insensitive) tag match wins, then a base-language match
    (``zh-TW`` -> ``zh-CN``); anything else falls back to ``en``. Always
    returns one of ``available_locales()``; the input is only ever compared
    against discovered template names, never used as a path.
    """
    available = available_locales()
    if not available:
        logger.error("No email templates found in %s", _TEMPLATES_DIR)
        return _FALLBACK_LOCALE
    fallback = _FALLBACK_LOCALE if _FALLBACK_LOCALE in available else available[0]
    tag = (locale or "").strip().lower()
    if not tag:
        return fallback
    for candidate in available:
        if candidate.lower() == tag:
            return candidate
    language = tag.split("-", 1)[0]
    for candidate in available:
        if candidate.split("-", 1)[0].lower() == language:
            return candidate
    return fallback


def render_verification_email(
    locale: str, *, verify_url: str, lifetime_seconds: int
) -> tuple[str, str, str]:
    """Render ``(subject, plain_body, html_body)`` for ``locale``.

    Raises ``jinja2.TemplateNotFound`` (or any rendering error) for locales
    without templates.
    """
    context = {
        "verify_url": verify_url,
        "lifetime_hours": lifetime_seconds // 3600,
        "lifetime_minutes": lifetime_seconds // 60,
    }
    env = _jinja_env()
    subject = env.get_template(f"{_TEMPLATE_STEM}.{locale}.subject.txt").render(context)
    plain = env.get_template(f"{_TEMPLATE_STEM}.{locale}.txt").render(context)
    html = env.get_template(f"{_TEMPLATE_STEM}.{locale}.html").render(context)
    return subject.strip(), plain.strip(), html.strip()


async def send_verification_email(
    user_email: str,
    token: str,
    settings: Settings,
    *,
    locale: str | None = None,
) -> None:
    """Send a verification email carrying the verification link.

    Spec: email-verification.md Section 5.2. Builds
    ``{verify_email_base_url or gateway_url}/auth/verify?token={token}`` and
    sends it as multipart/alternative, localized per ``locale``. No-op when
    ``smtp_host`` is unset or the sender address cannot be determined
    (unreachable with valid configuration, Section 3.1 startup validation).
    Failures are logged and never raised, so callers' flows (register /
    admin create / request-verify-token) are unaffected.
    """
    if settings.smtp_host is None:
        return
    from_addr = settings.smtp_from or settings.smtp_username
    if not from_addr:
        logger.warning(
            "SMTP configured but sender address undeterminable; "
            "skipping verification email to %s",
            user_email,
        )
        return

    base_url = settings.verify_email_base_url or settings.gateway_url
    verify_url = f"{base_url}/auth/verify?token={token}"

    try:
        resolved_locale = resolve_locale(locale)
        subject, plain_body, html_body = render_verification_email(
            resolved_locale,
            verify_url=verify_url,
            lifetime_seconds=settings.verify_email_token_lifetime_seconds,
        )
        conf = ConnectionConfig(
            MAIL_SERVER=settings.smtp_host,
            MAIL_PORT=settings.smtp_port,
            MAIL_USERNAME=settings.smtp_username or "",
            MAIL_PASSWORD=SecretStr(settings.smtp_password or ""),
            # fastapi-mail defaults USE_CREDENTIALS=True, which would make it
            # call smtp.login("", "") on every send when no credentials are
            # configured; skip SMTP AUTH entirely for unauthenticated relays
            # (spec: email-verification.md Section 3.1 GATEWAY_SMTP_USERNAME).
            USE_CREDENTIALS=bool(settings.smtp_username),
            MAIL_FROM=from_addr,
            MAIL_FROM_NAME=settings.smtp_from_name,
            MAIL_STARTTLS=settings.smtp_starttls,
            MAIL_SSL_TLS=settings.smtp_ssl_tls,
            TIMEOUT=settings.smtp_timeout,
        )
        message = MessageSchema(
            subject=subject,
            recipients=[user_email],
            body=html_body,
            subtype=MessageType.html,
            alternative_body=plain_body,
            multipart_subtype=MultipartSubtypeEnum.alternative,
        )
        await FastMail(conf).send_message(message)
        logger.info(
            "Verification email sent to %s in locale %s", user_email, resolved_locale
        )
    except Exception:
        logger.exception("Failed to send verification email to %s", user_email)
