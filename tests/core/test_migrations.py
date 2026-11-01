"""Verify the Day 0 Alembic schema matches the ORM."""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path

from mineru_gateway.db import Base

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ALEMBIC_INI = REPO_ROOT / "alembic.ini"

NOW = "2026-01-01 00:00:00.000000"


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


def _seed_user(conn: sqlite3.Connection, email: str = "owner@example.com") -> str:
    user_id = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO users (id, display_name, created_at, updated_at, email, "
        "hashed_password, is_active, is_superuser, is_verified) "
        "VALUES (?, ?, ?, ?, ?, ?, 1, 0, 1)",
        (user_id, "Owner", NOW, NOW, email, "x"),
    )
    return user_id


def _seed_key(
    conn: sqlite3.Connection, owner_id: str | None, prefix: str = "mru_key1"
) -> str:
    key_id = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO api_keys (id, key_hash, key_prefix, label, created_at, "
        "is_active, owner_id) VALUES (?, ?, ?, ?, ?, 1, ?)",
        (key_id, f"hash-{key_id}", prefix, "key", NOW, owner_id),
    )
    return key_id


def _seed_task(
    conn: sqlite3.Connection,
    api_key_id: str | None,
    idempotency_key: str | None = None,
) -> str:
    task_id = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO tasks (id, api_key_id, status, file_names, file_count, "
        "file_total_bytes, parse_params, upstream_url, retry_count, "
        "consecutive_poll_failures, created_at, idempotency_key) "
        "VALUES (?, ?, 'pending', '[]', 0, 0, '{}', 'http://mock-upstream', "
        "0, 0, ?, ?)",
        (task_id, api_key_id, NOW, idempotency_key),
    )
    return task_id


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
        assert {"tier", "parse_params", "idempotency_key", "owner_id"} <= set(task_info)
        assert {
            "backend",
            "parse_method",
            "effort",
            "response_format_zip",
        }.isdisjoint(task_info)
        assert task_info["tier"][3] == 0
        # Every task has exactly one owner; the creating key is audit only.
        assert task_info["owner_id"][3] == 1
        assert task_info["api_key_id"][3] == 0

        key_info = {
            row[1]: row for row in conn.execute("PRAGMA table_info('api_keys')")
        }
        assert key_info["owner_id"][3] == 1

        indexes = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")
        }
        assert "ix_tasks_owner_status_created" in indexes
        # Key-scoped scope and idempotency domains are gone.
        assert "ix_tasks_key_status_created" not in indexes
        assert "ix_tasks_api_key_id" not in indexes

        table_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'"
        ).fetchone()[0]
        assert "uq_tasks_owner_idempotency" in table_sql
        assert "uq_tasks_key_idempotency" not in table_sql
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


def test_owner_backfill_from_owned_keys(tmp_path):
    """Owned keys backfill tasks.owner_id so no task is left ownerless."""
    db_file = tmp_path / "backfill.db"
    env = _migration_env(db_file)

    result = _alembic_cmd("upgrade e6ce36543398", env, tmp_path)
    assert result.returncode == 0, result.stderr

    conn = sqlite3.connect(db_file)
    try:
        user_id = _seed_user(conn)
        key_id = _seed_key(conn, user_id)
        task_id = _seed_task(conn, key_id, "idem-1")
        conn.commit()
    finally:
        conn.close()

    result = _alembic_cmd("upgrade head", env, tmp_path)
    assert result.returncode == 0, result.stderr

    conn = sqlite3.connect(db_file)
    try:
        owner_id = conn.execute(
            "SELECT owner_id FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()[0]
        assert owner_id == user_id
    finally:
        conn.close()


def test_upgrade_drops_unowned_keys_and_their_tasks(tmp_path):
    """Breaking: an ownerless key and the tasks it created cannot survive."""
    db_file = tmp_path / "unowned.db"
    env = _migration_env(db_file)

    result = _alembic_cmd("upgrade e6ce36543398", env, tmp_path)
    assert result.returncode == 0, result.stderr

    conn = sqlite3.connect(db_file)
    try:
        user_id = _seed_user(conn)
        owned_key_id = _seed_key(conn, user_id, "mru_own1")
        service_key_id = _seed_key(conn, None, "mru_svc1")
        kept_task = _seed_task(conn, owned_key_id)
        dropped_task = _seed_task(conn, service_key_id)
        conn.commit()
    finally:
        conn.close()

    result = _alembic_cmd("upgrade head", env, tmp_path)
    assert result.returncode == 0, result.stderr

    conn = sqlite3.connect(db_file)
    try:
        tasks = {row[0] for row in conn.execute("SELECT id FROM tasks")}
        assert tasks == {kept_task}
        keys = {row[0] for row in conn.execute("SELECT id FROM api_keys")}
        assert keys == {owned_key_id}
        assert dropped_task not in tasks
        assert service_key_id not in keys
    finally:
        conn.close()


def test_upgrade_collapses_idempotency_domains(tmp_path):
    """Duplicates across one owner's credentials keep only the earliest marker."""
    db_file = tmp_path / "idem.db"
    env = _migration_env(db_file)

    result = _alembic_cmd("upgrade e6ce36543398", env, tmp_path)
    assert result.returncode == 0, result.stderr

    conn = sqlite3.connect(db_file)
    try:
        user_id = _seed_user(conn)
        key1 = _seed_key(conn, user_id, "mru_key1")
        key2 = _seed_key(conn, user_id, "mru_key2")
        first = _seed_task(conn, key1, "shared-idem")
        second = _seed_task(conn, key2, "shared-idem")
        conn.execute(
            "UPDATE tasks SET created_at = '2026-01-02 00:00:00.000000' WHERE id = ?",
            (second,),
        )
        conn.commit()
    finally:
        conn.close()

    result = _alembic_cmd("upgrade head", env, tmp_path)
    assert result.returncode == 0, result.stderr

    conn = sqlite3.connect(db_file)
    try:
        rows = dict(
            conn.execute("SELECT id, idempotency_key FROM tasks ORDER BY id").fetchall()
        )
        assert rows[first] == "shared-idem"
        assert rows[second] is None
    finally:
        conn.close()


def test_downgrade_refuses_when_data_exists(tmp_path):
    """The forward migration deletes rows, so it cannot be rolled back."""
    db_file = tmp_path / "downgrade-guard.db"
    env = _migration_env(db_file)

    result = _alembic_cmd("upgrade e6ce36543398", env, tmp_path)
    assert result.returncode == 0, result.stderr

    conn = sqlite3.connect(db_file)
    try:
        user_id = _seed_user(conn)
        key_id = _seed_key(conn, user_id)
        _seed_task(conn, key_id)
        conn.commit()
    finally:
        conn.close()

    result = _alembic_cmd("upgrade head", env, tmp_path)
    assert result.returncode == 0, result.stderr

    result = _alembic_cmd("downgrade -1", env, tmp_path)
    assert result.returncode != 0
    assert "Cannot downgrade" in result.stderr

    conn = sqlite3.connect(db_file)
    try:
        revision = conn.execute("SELECT version_num FROM alembic_version").fetchone()
        assert revision[0] == "d269a836066a"
        assert conn.execute("SELECT count(*) FROM tasks").fetchone()[0] == 1
    finally:
        conn.close()
