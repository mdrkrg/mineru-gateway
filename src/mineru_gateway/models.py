"""ORM models: ApiKey, TaskRecord. SQLite/PG portable."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _uuid_str() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
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
    # Reserved for future user system / OAuth: owner_id (nullable, FK)


class TaskRecord(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    api_key_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("api_keys.id"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(20), index=True, default="pending")

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
    )
