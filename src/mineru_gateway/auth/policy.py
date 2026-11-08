"""Auth rules that depend only on settings and account state.

Spec: email-verification.md Section 3.1 (startup refusals),
user-management-and-oauth.md Sections 3.1 and 4.5 (provider linking).

The rules live here so the tables in those specs have one executable home:
the app factory and the OIDC callback apply a decision instead of re-deriving
it from ad-hoc conditions.
"""

from __future__ import annotations

from collections.abc import Callable
from enum import StrEnum
from typing import NamedTuple

from ..config import Settings


class _StartupRule(NamedTuple):
    violated: Callable[[Settings], bool]
    message: str


# Ordered: a configuration can break several rules at once, and the first
# message should be the one that explains the rest (no mailbox flow first).
_STARTUP_RULES: tuple[_StartupRule, ...] = (
    _StartupRule(
        # Section 3.1: the admin plane mints owners and API keys.
        lambda s: s.admin_token.strip() in {"", "change-me"},
        "GATEWAY_ADMIN_TOKEN must be set to a strong value: the admin plane "
        "provisions owners and issues API keys",
    ),
    _StartupRule(
        # Section 3.1 / 7.1: tokens are signed with this secret.
        lambda s: s.user_auth_enabled and len(s.jwt_secret) < 32,
        "GATEWAY_JWT_SECRET must be at least 32 characters when "
        "GATEWAY_USER_AUTH_ENABLED is true",
    ),
    _StartupRule(
        # Section 3.1: a closed gate without SMTP locks users out.
        lambda s: (
            s.user_auth_enabled
            and not s.allow_unverified_accounts
            and s.smtp_host is None
        ),
        "GATEWAY_USER_AUTH_ENABLED=true with "
        "GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS=false requires GATEWAY_SMTP_HOST; "
        "configure SMTP or set GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS=true",
    ),
    _StartupRule(
        # Open registration plus a provider identity is a sign-in block: the
        # squatter holds the only local row and the real owner cannot verify.
        lambda s: (
            s.user_auth_enabled
            and bool(s.oidc_providers)
            and s.open_registration
            and s.smtp_host is None
        ),
        "GATEWAY_OPEN_REGISTRATION=true with GATEWAY_OIDC_PROVIDERS requires "
        "GATEWAY_SMTP_HOST: without a mailbox flow a registered address can "
        "never be verified, so whoever registers it first can permanently "
        "block the real owner's provider login. Configure SMTP or disable "
        "GATEWAY_OPEN_REGISTRATION",
    ),
)


def startup_violations(settings: Settings) -> list[str]:
    """Every refusal this configuration triggers, in spec order.

    Returning all of them avoids a restart loop; the no-mailbox rule and the
    OIDC rule commonly fire together.
    """
    return [rule.message for rule in _STARTUP_RULES if rule.violated(settings)]


class LocalAccount(NamedTuple):
    """The subset of a ``User`` row the linking rules depend on."""

    is_active: bool
    is_verified: bool


class LinkDecision(StrEnum):
    """Spec 4.5 step 4: what a completed provider login does."""

    EXISTING_ACCOUNT = "existing_account"
    CREATE = "create"
    LINK = "link"
    REFUSE_INACTIVE = "refuse_inactive"
    REFUSE_LOCAL_UNVERIFIED = "refuse_local_unverified"
    REFUSE_PROVIDER_UNVERIFIED = "refuse_provider_unverified"
    REFUSE_CLAIM_MISSING = "refuse_claim_missing"


def oidc_link_decision(
    *,
    has_oauth_account: bool,
    local: LocalAccount | None,
    provider_verified: bool | None,
) -> LinkDecision:
    """Spec 4.5 step 4: decide what to do with a provider login.

    - ``local`` is the row matched by email, or None when no row exists.
    - ``provider_verified`` is the claim after the trusted-domain exception;
      None means the claim was missing.
    - An existing OAuthAccount keeps working regardless of ``is_verified``;
      a fresh row inherits the provider assertion.
    - Inactivity is checked only on the positive-assertion path: a row whose
      provider refused the address is refused for that reason instead.
    """
    if has_oauth_account:
        if local is None or local.is_active:
            return LinkDecision.EXISTING_ACCOUNT
        return LinkDecision.REFUSE_INACTIVE
    if local is None:
        return LinkDecision.CREATE
    if provider_verified is True:
        if not local.is_active:
            return LinkDecision.REFUSE_INACTIVE
        if not local.is_verified:
            return LinkDecision.REFUSE_LOCAL_UNVERIFIED
        return LinkDecision.LINK
    if provider_verified is False:
        return LinkDecision.REFUSE_PROVIDER_UNVERIFIED
    return LinkDecision.REFUSE_CLAIM_MISSING


_LINK_ERRORS: dict[LinkDecision, tuple[int, str]] = {
    LinkDecision.REFUSE_INACTIVE: (400, "User is inactive"),
    LinkDecision.REFUSE_PROVIDER_UNVERIFIED: (
        409,
        "Email exists but not verified by provider",
    ),
    LinkDecision.REFUSE_CLAIM_MISSING: (
        400,
        "Email exists but email_verified claim missing",
    ),
}


def link_error(decision: LinkDecision, *, has_smtp: bool) -> tuple[int, str]:
    """HTTP status and body for a refusal decision.

    Only refusals are valid input; anything else is a caller bug. The remedy
    for an unverified local row depends on whether SMTP can send (spec 4.5).
    """
    if decision is LinkDecision.REFUSE_LOCAL_UNVERIFIED:
        if has_smtp:
            return 409, (
                "Email is registered but not verified; verify it, then retry "
                "the provider login"
            )
        return 409, (
            "Email is registered but not verified, and this gateway has no "
            "email verification flow; ask the operator to enable "
            "GATEWAY_SMTP_HOST or to remove the account from the gateway "
            "database"
        )
    return _LINK_ERRORS[decision]
