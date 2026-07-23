"""Application configuration (env prefix: GATEWAY_)."""

from __future__ import annotations

from functools import lru_cache

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


class OIDCProviderConfig(BaseModel):
    """Section 3.2: OIDC provider configuration entry."""

    name: str
    openid_configuration_endpoint: str
    client_id: str
    client_secret: str


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

    # --- User management & OAuth (Section 3.1) ---
    user_auth_enabled: bool = False
    jwt_secret: str = "change-me"
    jwt_access_lifetime_seconds: int = 900
    jwt_refresh_lifetime_seconds: int = 604800
    open_registration: bool = False
    oidc_providers: list[OIDCProviderConfig] = []
    oauth_redirect_base_url: str = ""
    oauth_frontend_redirect_url: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
