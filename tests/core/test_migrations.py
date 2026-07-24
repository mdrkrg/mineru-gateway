"""Verify the Alembic migration produces the schema the ORM models expect.

Spec: mvp-implementation.md §4 (数据模型 ApiKey/TaskRecord), §4「约束与索引」
((api_key_id, status, created_at) 复合索引), §2 (Alembic 为迁移工具).
Plan: Phase 1 — "SQLAlchemy 模型 ... + Alembic 迁移".

Runs `alembic upgrade head` against a throwaway SQLite database (via subprocess,
matching how migrations run in production) and asserts the expected tables and
the (api_key_id, status, created_at) composite index are created.
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path

from mineru_gateway.db import Base

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _alembic_cmd(cmd: str, env: dict, db_file: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["uv", "run", "alembic", *cmd.split()],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
    )


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


def _now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


_OLD_PARAM_MIGRATION_REV = "58345c653dfc"
_OLD_PARAM_PRE_REV = "d6dd58a7fa28"


def _insert_seed_rows(conn: sqlite3.Connection, api_key_id: str) -> tuple[str, str]:
    """Insert two task rows with the pre-migration schema (old param columns).

    Returns (task1_id, task2_id).
    """
    now = _now_iso()
    t1_id = str(uuid.uuid4())
    t2_id = str(uuid.uuid4())

    conn.execute(
        """INSERT INTO tasks (
            id, api_key_id, status, file_names, file_count, file_total_bytes,
            backend, parse_method, lang_list, effort,
            formula_enable, table_enable, image_analysis,
            return_md, return_middle_json, return_model_output,
            return_content_list, return_images, response_format_zip,
            return_original_file, client_side_output_generation,
            server_url, start_page_id, end_page_id,
            upstream_url, retry_count, consecutive_poll_failures,
            created_at
        ) VALUES (?, ?, 'pending', '["a.pdf"]', 1, 1024,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            'http://up', 0, 0,
            ?
        )""",
        (
            t1_id,
            api_key_id,
            "pipeline",
            "auto",
            json.dumps(["en", "ch"]),
            "high",
            True,
            False,
            True,
            True,
            False,
            True,
            True,
            False,
            True,
            False,
            True,
            "http://custom:8000",
            5,
            10,
            now,
        ),
    )

    conn.execute(
        """INSERT INTO tasks (
            id, api_key_id, status, file_names, file_count, file_total_bytes,
            backend, upstream_url, retry_count, consecutive_poll_failures,
            created_at
        ) VALUES (?, ?, 'completed', '["b.pdf"]', 1, 2048,
            'hybrid-engine', 'http://up2', 0, 0,
            ?
        )""",
        (t2_id, api_key_id, now),
    )

    conn.commit()
    return t1_id, t2_id


def test_parse_params_data_migration_upgrade_downgrade(tmp_path):
    """§8.2: Old 14 param columns -> parse_params JSON (with data migration).

    - Create DB at pre-migration revision, insert rows with old-style columns.
    - Upgrade to parse_params revision, verify JSON column content.
    - Downgrade back, verify old columns are restored.
    """
    db_file = tmp_path / "migrated.db"
    env = {**os.environ, "GATEWAY_DATABASE_URL": f"sqlite+aiosqlite:///{db_file}"}

    # Upgrade to the revision just before parse_params migration.
    result = _alembic_cmd(f"upgrade {_OLD_PARAM_PRE_REV}", env, db_file)
    assert result.returncode == 0, result.stderr

    # Insert seed rows using the old schema.
    conn = sqlite3.connect(db_file)
    try:
        api_key_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO api_keys (id, key_hash, key_prefix, label, created_at, is_active) "
            "VALUES (?, 'hash', 'prefix', 'test', ?, 1)",
            (api_key_id, _now_iso()),
        )
        conn.commit()
        t1_id, t2_id = _insert_seed_rows(conn, api_key_id)
    finally:
        conn.close()

    # Run the parse_params migration.
    result = _alembic_cmd(f"upgrade {_OLD_PARAM_MIGRATION_REV}", env, db_file)
    assert result.returncode == 0, result.stderr + "\n" + result.stdout

    # Validate parse_params JSON content after upgrade.
    conn = sqlite3.connect(db_file)
    try:
        cur = conn.execute("SELECT id, parse_params FROM tasks")
        by_id = {
            row_id: json.loads(pp_raw) if isinstance(pp_raw, str) else pp_raw
            for row_id, pp_raw in cur.fetchall()
        }
        assert t1_id in by_id
        assert t2_id in by_id

        pp = by_id[t1_id]
        assert pp["backend"] == "pipeline"
        assert pp["parse_method"] == "auto"
        assert pp["lang_list"] == ["en", "ch"]
        assert pp["effort"] == "high"
        assert pp["formula_enable"] is True
        assert pp["table_enable"] is False
        assert pp["image_analysis"] is True
        assert pp["return_md"] is True
        assert pp["return_middle_json"] is False
        assert pp["return_model_output"] is True
        assert pp["return_content_list"] is True
        assert pp["return_images"] is False
        assert pp["response_format_zip"] is True
        assert pp["return_original_file"] is False
        assert pp["client_side_output_generation"] is True
        assert pp["server_url"] == "http://custom:8000"
        assert pp["start_page_id"] == 5
        assert pp["end_page_id"] == 10

        pp2 = by_id[t2_id]
        assert pp2["backend"] == "hybrid-engine"
        assert set(pp2.keys()) == {"backend"}
    finally:
        conn.close()

    # Downgrade back to pre-migration revision.
    result = _alembic_cmd(f"downgrade {_OLD_PARAM_PRE_REV}", env, db_file)
    assert result.returncode == 0, result.stderr + "\n" + result.stdout

    # Validate old columns are restored and parse_params is gone.
    conn = sqlite3.connect(db_file)
    try:
        cols = {row[1] for row in conn.execute("PRAGMA table_info('tasks')")}
        assert "parse_params" not in cols
        for col in ("formula_enable", "lang_list", "return_md", "start_page_id"):
            assert col in cols, f"{col} missing after downgrade"

        cur = conn.execute(
            "SELECT formula_enable, table_enable, image_analysis, "
            "return_md, return_middle_json, return_model_output, "
            "return_content_list, return_images, response_format_zip, "
            "return_original_file, client_side_output_generation, "
            "server_url, start_page_id, end_page_id, lang_list "
            "FROM tasks WHERE id = ?",
            (t1_id,),
        )
        row = cur.fetchone()
        assert row is not None
        (
            fe,
            te,
            ia,
            rmd,
            rmj,
            rmo,
            rcl,
            ri,
            rz,
            rof,
            csog,
            surl,
            sp,
            ep,
            ll,
        ) = row
        assert fe == 1
        assert te == 0
        assert ia == 1
        assert rmd == 1
        assert rmj == 0
        assert rmo == 1
        assert rcl == 1
        assert ri == 0
        assert rz == 1
        assert rof == 0
        assert csog == 1
        assert surl == "http://custom:8000"
        assert sp == 5
        assert ep == 10
        assert json.loads(ll) == ["en", "ch"]

        cur2 = conn.execute(
            "SELECT formula_enable, return_md, start_page_id, lang_list "
            "FROM tasks WHERE id = ?",
            (t2_id,),
        )
        row2 = cur2.fetchone()
        assert row2 is not None
        fe2, rmd2, sp2, ll2 = row2
        assert fe2 is None
        assert rmd2 is None
        assert sp2 is None
        assert ll2 is None
    finally:
        conn.close()
