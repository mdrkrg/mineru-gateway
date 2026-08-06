"""Application configuration (env prefix: GATEWAY_)."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from urllib.parse import urlparse


from pydantic import BaseModel, ValidationInfo, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9\-]+$")

_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}


def _validate_https_endpoint(value: str | None, field: str) -> str | None:
    """
    specs/user-management-and-oauth.md Section 3.2:
    endpoints must be https; loopback may use http.
    """
    if value is None:
        return value
    parsed = urlparse(value)
    if parsed.scheme == "https":
        return value
    if parsed.scheme == "http" and parsed.hostname in _LOOPBACK_HOSTS:
        return value
    raise ValueError(
        f"{field} must be an https:// URL (http only allowed for loopback), "
        f"got: {value!r}"
    )


class OIDCProviderConfig(BaseModel):
    """
    specs/user-management-and-oauth.md Section 3.2:
    OIDC provider configuration entry.
    """

    name: str
    openid_configuration_endpoint: str | None = None
    client_id: str
    client_secret: str
    authorization_endpoint: str | None = None
    token_endpoint: str | None = None
    userinfo_endpoint: str | None = None
    scopes: list[str] = ["openid", "email"]
    user_info_mapping: dict[str, str] = {"display_name": "name", "email": "email"}
    email_fallback_domain: str | None = None
    trusted_email_domains: list[str] = []

    @field_validator("name")
    @classmethod
    def _name_must_be_url_safe(cls, v: str) -> str:
        if not _NAME_PATTERN.match(v):
            raise ValueError(
                f"OIDC provider name {v!r} is not URL-safe; "
                f"use only letters, digits, and hyphens"
            )
        return v

    @field_validator(
        "openid_configuration_endpoint",
        "authorization_endpoint",
        "token_endpoint",
        "userinfo_endpoint",
    )
    @classmethod
    def _endpoint_must_be_https(cls, v: str | None, info: ValidationInfo):
        return _validate_https_endpoint(v, info.field_name)

    @model_validator(mode="after")
    def _validate_mode(self) -> "OIDCProviderConfig":
        has_discovery = self.openid_configuration_endpoint is not None
        has_auth = self.authorization_endpoint is not None
        has_token = self.token_endpoint is not None

        if has_discovery:
            self.authorization_endpoint = None
            self.token_endpoint = None
            self.userinfo_endpoint = None
        else:
            if not has_auth or not has_token:
                missing = []
                if not has_auth:
                    missing.append("authorization_endpoint")
                if not has_token:
                    missing.append("token_endpoint")
                raise ValueError(
                    f"Mode B (manual) requires authorization_endpoint and "
                    f"token_endpoint; missing: {', '.join(missing)}"
                )

        return self


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="GATEWAY_",
        env_file=".env",
        extra="ignore",
    )

    upstream_url: str = "http://127.0.0.1:8002"
    database_url: str = "sqlite+aiosqlite:///./gateway.db"
    admin_token: str = "change-me"
    allow_anonymous: bool = False

    gateway_url: str = "http://127.0.0.1:8000"
    max_upload_size: int = 524_288_000  # 500MB
    rate_limit_per_key: int = 10
    task_retention_days: int = 90

    # Schema is managed by Alembic in production; auto-create is opt-in
    # (tests / local one-shot setups) to avoid drift between the two paths.
    create_tables: bool = False

    # --- Phase 4: protection ---
    # Global cap on in-flight (pending + processing) tasks across all keys.
    # 0 disables the cap.
    max_concurrent_tasks: int = 0
    log_level: str = "INFO"
    json_logs: bool = True
    workers: int = 1

    # --- Phase 3: disaster recovery ---
    file_cache_dir: str = "/tmp/gateway-cache"
    enable_background: bool = True
    status_sync_interval: float = 5.0
    retry_interval: float = 10.0
    cleanup_interval: float = 3600.0
    max_retries: int = 3
    poll_failure_threshold: int = 3

    # --- User management & OAuth ---
    user_auth_enabled: bool = False
    jwt_secret: str = "change-me"
    jwt_access_lifetime_seconds: int = 900
    jwt_refresh_lifetime_seconds: int = 604800
    open_registration: bool = False
    oidc_providers: list[OIDCProviderConfig] = []
    oauth_redirect_base_url: str = ""
    oauth_frontend_redirect_url: str = ""

    # --- CORS ---
    cors_allow_origins: list[str] = ["*"]
    cors_allow_methods: list[str] = ["*"]
    cors_allow_headers: list[str] = ["*"]
    cors_allow_credentials: bool = False
    cors_max_age: int = 600

    @field_validator(
        "cors_allow_origins",
        "cors_allow_methods",
        "cors_allow_headers",
        mode="before",
    )
    @classmethod
    def _parse_cors_list(cls, v: object, info: ValidationInfo) -> list[str]:
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("[") and v.endswith("]"):
                try:
                    parsed = json.loads(v)
                except json.JSONDecodeError:
                    raise ValueError(
                        f"{info.field_name} must be a valid JSON array or "
                        f"a comma-separated list, got: {v!r}"
                    ) from None
                if not isinstance(parsed, list):
                    raise ValueError(
                        f"{info.field_name} must be a JSON array, got {type(parsed).__name__}"
                    )
                return parsed
            return [item.strip() for item in v.split(",") if item.strip()]
        return v  # type: ignore[return-value]

    @field_validator("oidc_providers")
    @classmethod
    def _validate_unique_provider_names(
        cls, v: list[OIDCProviderConfig]
    ) -> list[OIDCProviderConfig]:
        names = [p.name for p in v]
        if len(names) != len(set(names)):
            raise ValueError(
                f"OIDC provider names must be unique, got duplicates: "
                f"{[n for n in names if names.count(n) > 1]}"
            )
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
