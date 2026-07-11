"""Application configuration (env prefix: GATEWAY_)."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


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


@lru_cache
def get_settings() -> Settings:
    return Settings()
