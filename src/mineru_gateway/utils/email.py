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
