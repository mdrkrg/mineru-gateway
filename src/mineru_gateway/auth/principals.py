"""Task request principals.

A task request authenticates with an API key (programmatic clients) or a JWT
(the web UI); both resolve to the same owner. The credential only determines
how the caller was authenticated.

Spec: specs/task-ownership.md.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import StrEnum

from fastapi import HTTPException

from ..config import Settings
from ..models import ApiKey, User


class AuthType(StrEnum):
    """Credential that authenticated a task request."""

    JWT = "jwt"
    API_KEY = "api_key"


@dataclass(frozen=True)
class TaskPrincipal:
    """Authenticated caller for task endpoints.

    A plain value object: it keeps only IDs, never ORM instances, so it stays
    valid after the request session rolls back (rollback expires ORM objects,
    and re-reading an expired attribute raises ``MissingGreenlet``).

    ``owner_id`` is the authoritative task owner and is never ``None``: the user
    for JWTs, the key owner for API keys.
    ``auth_type`` is explicit because ``api_key_id`` is audit data and must not
    decide how the caller authenticated.
    """

    owner_id: uuid.UUID
    auth_type: AuthType
    api_key_id: uuid.UUID | None = None
    # Only meaningful for JWT callers; API keys are gated at issuance.
    is_verified: bool = False

    @classmethod
    def from_user(cls, user: User) -> TaskPrincipal:
        return cls(
            owner_id=user.id, auth_type=AuthType.JWT, is_verified=user.is_verified
        )

    @classmethod
    def from_api_key(cls, api_key: ApiKey) -> TaskPrincipal:
        return cls(
            owner_id=api_key.owner_id,
            auth_type=AuthType.API_KEY,
            api_key_id=api_key.id,
        )


def ensure_verified(is_verified: bool, settings: Settings) -> None:
    """GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS gate (default: unverified -> 403)."""
    if not settings.allow_unverified_accounts and not is_verified:
        raise HTTPException(status_code=403, detail="Email not verified")


def ensure_can_create_tasks(
    principal: TaskPrincipal | None, settings: Settings
) -> None:
    """Apply the email-verification gate to JWT task creation.

    API keys are already gated at issuance. Anonymous requests are handled by
    the caller (passthrough) and are not affected.
    """
    if principal is None or principal.auth_type is not AuthType.JWT:
        return
    ensure_verified(principal.is_verified, settings)
