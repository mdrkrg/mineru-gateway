"""Email addresses as the gateway stores and compares them.

Identity is whatever SQL ``lower()`` produces: every lookup compares
``lower(email)`` on both sides, and ``uq_users_email_lower`` indexes that same
expression. SQL folding of non-ASCII is backend-dependent (SQLite folds ASCII
only unless built with ICU), so addresses are canonicalized to pure ASCII at
the boundary: an IDN domain is downgraded to its punycode form, while a local
part that would need SMTPUTF8 is refused outright.
"""

from __future__ import annotations

from typing import Annotated

from email_validator import validate_email
from pydantic import AfterValidator, EmailStr


def _canonicalize(value: str) -> str:
    """Downgrade an already-validated address to its ASCII form.

    ``EmailStr`` keeps the unicode domain and offers no hook to change that, so
    the validation (DNS-free) is re-run for ``ascii_email``. It is ``None``
    exactly when the local part cannot be expressed without SMTPUTF8.
    """
    ascii_email = validate_email(value, check_deliverability=False).ascii_email
    if ascii_email is None:
        raise ValueError(
            "Email local part must be ASCII: SMTPUTF8 addresses are not supported"
        )
    return ascii_email


# Canonical ASCII address, on top of EmailStr's syntax check.
AsciiEmail = Annotated[EmailStr, AfterValidator(_canonicalize)]


def ascii_domain(domain: str) -> str:
    """Fold a mail domain the way stored addresses are folded.

    IDN labels become punycode and the result is lowercased, so a configured
    domain compares equal to the domain of a canonicalized address. Raises
    ``EmailNotValidError`` (a ``ValueError``) for unusable values, which is how
    provider config rejects a domain that could never match.
    """
    # Reuse the address canonicalizer: the local part is fixed to "x", so the
    # SMTPUTF8 refusal can never trigger here.
    return _canonicalize(f"x@{domain.strip()}").rsplit("@", 1)[1]
