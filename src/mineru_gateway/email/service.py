"""SMTP email sending via fastapi-mail (spec: email-verification.md Section 5.2).

The send function is the seam tests stub out: tests replace
``mineru_gateway.email.service.send_verification_email`` with a test double
so no real SMTP connection is ever made.
"""

from __future__ import annotations

import logging

from fastapi_mail import ConnectionConfig, FastMail, MessageSchema, MessageType
from pydantic import SecretStr

from ..config import Settings

logger = logging.getLogger(__name__)


async def send_verification_email(
    user_email: str, token: str, settings: Settings
) -> None:
    """Send a verification email carrying the verification link.

    Spec: email-verification.md Section 5.2. Builds the link
    ``{verify_email_base_url or gateway_url}/auth/verify?token={token}`` and
    sends it via the configured SMTP server. Defensively returns without
    sending when ``smtp_host`` is unset or the sender address cannot be
    determined (unreachable with valid configuration, Section 3.1 startup
    validation). Send failures are logged and never raised, so callers'
    flows (register / admin create / request-verify-token) are unaffected.
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
            subject="Verify your email address",
            recipients=[user_email],
            body=(
                f"Please verify your email address by opening this link:\n{verify_url}\n"
            ),
            subtype=MessageType.plain,
        )
        await FastMail(conf).send_message(message)
    except Exception:
        logger.exception("Failed to send verification email to %s", user_email)
