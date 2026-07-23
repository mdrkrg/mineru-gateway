"""ORM models: ApiKey, TaskRecord. SQLite/PG portable."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi_users.db import (
    SQLAlchemyBaseOAuthAccountTable,
    SQLAlchemyBaseUserTable,
)
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from mineru_gateway.db import Base
from mineru_gateway.utils.uuid import get_uuid


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=get_uuid)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    key_prefix: Mapped[str] = mapped_column(String(8))
    label: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(),
        ForeignKey("users.id", name="fk_api_keys_owner_id"),
        nullable=True,
        index=True,
    )

    # Relationships
    owner: Mapped["User | None"] = relationship("User", back_populates="api_keys")


class TaskRecord(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=get_uuid)
    api_key_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("api_keys.id"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(20), index=True, default="pending")
    idempotency_key: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # File info
    file_names: Mapped[list] = mapped_column(JSON, default=list)
    file_count: Mapped[int] = mapped_column(Integer, default=0)
    file_total_bytes: Mapped[int] = mapped_column(Integer, default=0)

    # Parse parameters
    backend: Mapped[str] = mapped_column(String(50), default="hybrid-engine")
    parse_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    lang_list: Mapped[list | None] = mapped_column(JSON, nullable=True)
    effort: Mapped[str | None] = mapped_column(String(50), nullable=True)
    formula_enable: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    table_enable: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    image_analysis: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    return_md: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    return_middle_json: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    return_model_output: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    return_content_list: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    return_images: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    response_format_zip: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    return_original_file: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    client_side_output_generation: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True
    )
    server_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    start_page_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_page_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Upstream mapping
    upstream_url: Mapped[str] = mapped_column(String(500))
    upstream_task_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    consecutive_poll_failures: Mapped[int] = mapped_column(Integer, default=0)
    queued_ahead: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # File cache
    cache_dir: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    upstream_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_tasks_key_status_created", "api_key_id", "status", "created_at"),
        UniqueConstraint(
            "api_key_id", "idempotency_key", name="uq_tasks_key_idempotency"
        ),
    )


class User(SQLAlchemyBaseUserTable, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=get_uuid)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    # Relationships
    api_keys: Mapped[list["ApiKey"]] = relationship("ApiKey", back_populates="owner")
    oauth_accounts: Mapped[list["OAuthAccount"]] = relationship(
        "OAuthAccount", back_populates="user"
    )


class OAuthAccount(SQLAlchemyBaseOAuthAccountTable, Base):
    __tablename__ = "oauth_accounts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=get_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("users.id", ondelete="cascade"), nullable=False
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="oauth_accounts")

    __table_args__ = (UniqueConstraint("oauth_name", "account_id"),)
