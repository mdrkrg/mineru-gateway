"""replace 14 parse param columns in tasks with parse_params JSON

Revision ID: 58345c653dfc
Revises: d6dd58a7fa28
Create Date: 2026-07-24 10:38:52.520301

"""
from typing import Sequence, Union

import json

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '58345c653dfc'
down_revision: Union[str, Sequence[str], None] = 'd6dd58a7fa28'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_PARAM_COLUMNS = [
    "lang_list",
    "formula_enable",
    "table_enable",
    "image_analysis",
    "return_md",
    "return_middle_json",
    "return_model_output",
    "return_content_list",
    "return_images",
    "response_format_zip",
    "return_original_file",
    "client_side_output_generation",
    "server_url",
    "start_page_id",
    "end_page_id",
]

_BOOL_COLS = {
    "formula_enable",
    "table_enable",
    "image_analysis",
    "return_md",
    "return_middle_json",
    "return_model_output",
    "return_content_list",
    "return_images",
    "response_format_zip",
    "return_original_file",
    "client_side_output_generation",
}
_JSON_COLS = {"lang_list"}
_STR_COLS = {"server_url"}
_INT_COLS = {"start_page_id", "end_page_id"}

_OLD_COL_ADD_ORDER = [
    "return_model_output",
    "end_page_id",
    "return_middle_json",
    "return_content_list",
    "start_page_id",
    "client_side_output_generation",
    "formula_enable",
    "table_enable",
    "image_analysis",
    "server_url",
    "response_format_zip",
    "return_original_file",
    "return_images",
    "return_md",
    "lang_list",
]

def _col_type(name: str):
    if name in _JSON_COLS:
        return sa.JSON()
    if name in _STR_COLS:
        return sa.String(500)
    if name in _INT_COLS:
        return sa.Integer()
    return sa.Boolean()

_PARAM_NAMES = [
    "backend",
    "parse_method",
    "effort",
    "lang_list",
    "formula_enable",
    "table_enable",
    "image_analysis",
    "return_md",
    "return_middle_json",
    "return_model_output",
    "return_content_list",
    "return_images",
    "response_format_zip",
    "return_original_file",
    "client_side_output_generation",
    "server_url",
    "start_page_id",
    "end_page_id",
]


def upgrade() -> None:
    # 1. Add parse_params column with a server default so existing rows are
    #    NOT NULL compliant before the data backfill.
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("parse_params", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )

    # 2. Migrate: read every old column value + backend/parse_method/effort
    #    into parse_params for each row.
    connection = op.get_bind()
    quoted_cols = ", ".join(f'"{c}"' for c in _PARAM_NAMES)
    result = connection.execute(
        sa.text(f'SELECT id, {quoted_cols} FROM tasks')
    )
    for row in result:
        params: dict = {}
        for col in _PARAM_NAMES:
            value = getattr(row, col, None)
            if value is not None:
                if col in _JSON_COLS and isinstance(value, str):
                    value = json.loads(value)
                if col in _BOOL_COLS:
                    value = bool(value)
                params[col] = value
        connection.execute(
            sa.text("UPDATE tasks SET parse_params = :params WHERE id = :id"),
            {"params": json.dumps(params), "id": row.id},
        )

    # 3. Drop the 14 old columns.
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        for col in _OLD_PARAM_COLUMNS:
            batch_op.drop_column(col)


def downgrade() -> None:
    # 1. Re-create the 14 old columns as nullable.
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        for col_name in _OLD_COL_ADD_ORDER:
            batch_op.add_column(sa.Column(col_name, _col_type(col_name), nullable=True))

    # 2. Restore data: read parse_params JSON and write back to old columns.
    connection = op.get_bind()
    result = connection.execute(sa.text("SELECT id, parse_params FROM tasks"))
    for row in result:
        params = row.parse_params
        if isinstance(params, str):
            params = json.loads(params)
        if not isinstance(params, dict):
            continue
        set_clauses = []
        bind_params = {"id": row.id}
        for col in _OLD_PARAM_COLUMNS:
            if col in params:
                set_clauses.append(f'"{col}" = :{col}')
                val = params[col]
                if col in _JSON_COLS:
                    val = val if isinstance(val, str) else json.dumps(val)
                bind_params[col] = val
        if set_clauses:
            connection.execute(
                sa.text(f"UPDATE tasks SET {', '.join(set_clauses)} WHERE id = :id"),
                bind_params,
            )

    # 3. Drop parse_params.
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.drop_column("parse_params")
