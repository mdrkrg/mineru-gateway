"""Verify the rewritten Day 0 Alembic schema matches the ORM."""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

from mineru_gateway.db import Base

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ALEMBIC_INI = REPO_ROOT / "alembic.ini"


def _alembic_cmd(cmd: str, env: dict, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(ALEMBIC_INI), *cmd.split()],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
    )


def _migration_env(db_file: Path) -> dict[str, str]:
    return {
        **os.environ,
        "GATEWAY_DATABASE_URL": f"sqlite+aiosqlite:///{db_file}",
    }


def test_upgrade_head_creates_v4_schema_matching_models(tmp_path):
    db_file = tmp_path / "migrated.db"
    env = _migration_env(db_file)

    result = _alembic_cmd("upgrade head", env, tmp_path)
    assert result.returncode == 0, result.stderr

    conn = sqlite3.connect(db_file)
    try:
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert set(Base.metadata.tables) <= tables

        task_info = {row[1]: row for row in conn.execute("PRAGMA table_info('tasks')")}
        assert set(Base.metadata.tables["tasks"].columns.keys()) == set(task_info)
        assert {"tier", "parse_params", "idempotency_key"} <= set(task_info)
        assert {
            "backend",
            "parse_method",
            "effort",
            "response_format_zip",
        }.isdisjoint(task_info)
        assert task_info["tier"][3] == 0

        indexes = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")
        }
        assert "ix_tasks_key_status_created" in indexes

        table_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'"
        ).fetchone()[0]
        assert "uq_tasks_key_idempotency" in table_sql
    finally:
        conn.close()

    result = _alembic_cmd("check", env, tmp_path)
    assert result.returncode == 0, result.stderr + result.stdout


def test_migrations_round_trip_base_and_head(tmp_path):
    db_file = tmp_path / "roundtrip.db"
    env = _migration_env(db_file)

    for command in ("upgrade head", "downgrade base", "upgrade head"):
        result = _alembic_cmd(command, env, tmp_path)
        assert result.returncode == 0, result.stderr + result.stdout
