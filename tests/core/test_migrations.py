"""Verify the Alembic migration produces the schema the ORM models expect.

Spec: mvp-implementation.md §4 (数据模型 ApiKey/TaskRecord), §4「约束与索引」
((api_key_id, status, created_at) 复合索引), §2 (Alembic 为迁移工具).
Plan: Phase 1 — "SQLAlchemy 模型 ... + Alembic 迁移".

Runs `alembic upgrade head` against a throwaway SQLite database (via subprocess,
matching how migrations run in production) and asserts the expected tables and
the (api_key_id, status, created_at) composite index are created.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
from pathlib import Path

from mineru_gateway.db import Base

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def test_upgrade_head_creates_expected_schema(tmp_path):
    """§4: alembic upgrade head 建出模型所有表及命名复合索引, 迁移与模型一致."""
    db_file = tmp_path / "migrated.db"
    env = {**os.environ, "GATEWAY_DATABASE_URL": f"sqlite+aiosqlite:///{db_file}"}
    result = subprocess.run(
        ["uv", "run", "alembic", "upgrade", "head"],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert db_file.exists()

    conn = sqlite3.connect(db_file)
    try:
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        model_tables = set(Base.metadata.tables.keys())
        assert model_tables <= tables

        indexes = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")
        }
        assert "ix_tasks_key_status_created" in indexes
    finally:
        conn.close()
