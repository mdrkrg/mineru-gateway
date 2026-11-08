"""Executable form of the startup and OIDC-linking matrices.

Spec: email-verification.md Section 3.1,
user-management-and-oauth.md Sections 3.1 and 4.5.

The HTTP-level suites prove the wiring; these tables pin the rules themselves
so a new row cannot be added to the spec without a matching decision.
"""

from __future__ import annotations

import pytest

from mineru_gateway.auth.policy import (
    LinkDecision,
    LocalAccount,
    link_error,
    oidc_link_decision,
    startup_violations,
)
from mineru_gateway.config import OIDCProviderConfig

_PROVIDER = OIDCProviderConfig(
    name="keycloak",
    openid_configuration_endpoint=(
        "https://keycloak.example.com/.well-known/openid-configuration"
    ),
    client_id="cid",
    client_secret="secret",
)

_ACTIVE_VERIFIED = LocalAccount(is_active=True, is_verified=True)
_ACTIVE_UNVERIFIED = LocalAccount(is_active=True, is_verified=False)
_INACTIVE = LocalAccount(is_active=False, is_verified=True)


def test_startup_reports_every_violation_in_spec_order(settings):
    """Fixing the first message must not merely uncover the second: a config
    that breaks both the mailbox and the OIDC rule gets both messages."""
    configured = settings.model_copy(
        update={
            "smtp_host": None,
            "allow_unverified_accounts": False,
            "open_registration": True,
            "oidc_providers": [_PROVIDER],
        }
    )
    violations = startup_violations(configured)
    assert len(violations) == 2
    assert "GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS=false" in violations[0]
    assert "GATEWAY_OPEN_REGISTRATION" in violations[1]


def test_startup_refusals_require_the_login_stack(settings):
    """G3/G4 guard accounts nobody can log into; with auth off they are moot."""
    configured = settings.model_copy(
        update={
            "user_auth_enabled": False,
            "jwt_secret": "short",
            "smtp_host": None,
            "allow_unverified_accounts": False,
            "open_registration": True,
            "oidc_providers": [_PROVIDER],
        }
    )
    assert startup_violations(configured) == []


@pytest.mark.parametrize(
    ("overrides", "needle"),
    [
        ({"admin_token": "change-me"}, "GATEWAY_ADMIN_TOKEN"),
        ({"jwt_secret": "short"}, "GATEWAY_JWT_SECRET"),
    ],
)
def test_startup_refuses_weak_credentials(settings, overrides, needle):
    violations = startup_violations(settings.model_copy(update=overrides))
    assert violations
    assert needle in violations[0]


@pytest.mark.parametrize(
    ("has_oauth_account", "local", "provider_verified", "expected"),
    [
        # Existing provider account: refresh, never re-check is_verified.
        (True, _ACTIVE_UNVERIFIED, False, LinkDecision.EXISTING_ACCOUNT),
        (True, _INACTIVE, True, LinkDecision.REFUSE_INACTIVE),
        # No local row: the new row inherits the provider assertion.
        (False, None, True, LinkDecision.CREATE),
        (False, None, False, LinkDecision.CREATE),
        (False, None, None, LinkDecision.CREATE),
        # Matched row: both sides must be verified before linking.
        (False, _ACTIVE_VERIFIED, True, LinkDecision.LINK),
        (False, _ACTIVE_UNVERIFIED, True, LinkDecision.REFUSE_LOCAL_UNVERIFIED),
        (False, _INACTIVE, True, LinkDecision.REFUSE_INACTIVE),
        (False, _ACTIVE_VERIFIED, False, LinkDecision.REFUSE_PROVIDER_UNVERIFIED),
        # A provider refusal wins over inactivity (Section 4.5 order).
        (False, _INACTIVE, False, LinkDecision.REFUSE_PROVIDER_UNVERIFIED),
        (False, _ACTIVE_VERIFIED, None, LinkDecision.REFUSE_CLAIM_MISSING),
    ],
)
def test_link_decision(has_oauth_account, local, provider_verified, expected):
    decision = oidc_link_decision(
        has_oauth_account=has_oauth_account,
        local=local,
        provider_verified=provider_verified,
    )
    assert decision is expected


def test_link_error_tailors_the_unverified_remedy():
    """Without SMTP the verify routes are not registered, so the two
    deployments must not share one "verify it" instruction."""
    with_smtp = link_error(LinkDecision.REFUSE_LOCAL_UNVERIFIED, has_smtp=True)
    without_smtp = link_error(LinkDecision.REFUSE_LOCAL_UNVERIFIED, has_smtp=False)

    assert with_smtp[0] == without_smtp[0] == 409
    assert "verify it" in with_smtp[1]
    assert "operator" in without_smtp[1]
