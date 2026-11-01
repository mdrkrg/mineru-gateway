"""add task ownership

Revision ID: d269a836066a
Revises: e6ce36543398
Create Date: 2026-10-31 14:15:02.055250

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd269a836066a'
down_revision: Union[str, Sequence[str], None] = 'e6ce36543398'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('owner_id', sa.Uuid(), nullable=True))
        batch_op.alter_column('api_key_id',
               existing_type=sa.CHAR(length=32),
               nullable=True)

    # Derive the owner from the creating key before the column becomes NOT NULL.
    op.execute(
        sa.text(
            """
            UPDATE tasks
            SET owner_id = (
                SELECT api_keys.owner_id
                FROM api_keys
                WHERE api_keys.id = tasks.api_key_id
            )
            WHERE owner_id IS NULL
            """
        )
    )

    # Breaking: an unowned key has no task scope any more, so neither the key
    # nor the tasks it created can survive the migration.
    op.execute(sa.text("DELETE FROM tasks WHERE owner_id IS NULL"))
    op.execute(sa.text("DELETE FROM api_keys WHERE owner_id IS NULL"))

    # Collapse the per-credential idempotency domains into one per owner: keep
    # the earliest task and drop the replay marker from the duplicates.
    op.execute(
        sa.text(
            """
            UPDATE tasks SET idempotency_key = NULL
            WHERE idempotency_key IS NOT NULL
              AND id IN (
                SELECT id FROM (
                    SELECT id,
                           row_number() OVER (
                               PARTITION BY owner_id, idempotency_key
                               ORDER BY created_at, id
                           ) AS rn
                    FROM tasks
                    WHERE idempotency_key IS NOT NULL
                ) ranked
                WHERE ranked.rn > 1
              )
            """
        )
    )

    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.alter_column('owner_id',
               existing_type=sa.CHAR(length=32),
               nullable=False)
        batch_op.drop_index(batch_op.f('ix_tasks_api_key_id'))
        batch_op.drop_index('ix_tasks_key_status_created')
        batch_op.drop_constraint('uq_tasks_key_idempotency', type_='unique')
        batch_op.create_index('ix_tasks_owner_status_created', ['owner_id', 'status', 'created_at'], unique=False)
        batch_op.create_unique_constraint('uq_tasks_owner_idempotency', ['owner_id', 'idempotency_key'])
        batch_op.create_foreign_key('fk_tasks_owner_id', 'users', ['owner_id'], ['id'])

    with op.batch_alter_table('api_keys', schema=None) as batch_op:
        batch_op.alter_column('owner_id',
               existing_type=sa.CHAR(length=32),
               nullable=False)

    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema.

    The forward migration deletes unowned keys and their tasks, so it cannot be
    undone: refuse while any row exists instead of silently recreating a schema
    that no longer describes the data.
    """
    bind = op.get_bind()
    for table in ('tasks', 'api_keys'):
        if (
            bind.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).first()
            is not None
        ):
            raise RuntimeError(
                "Cannot downgrade: this migration deletes unowned API keys and "
                f"their tasks. Empty {table} first, or restore a backup."
            )

    with op.batch_alter_table('api_keys', schema=None) as batch_op:
        batch_op.alter_column('owner_id',
               existing_type=sa.CHAR(length=32),
               nullable=True)

    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.drop_constraint('uq_tasks_owner_idempotency', type_='unique')
        batch_op.drop_constraint('fk_tasks_owner_id', type_='foreignkey')
        batch_op.drop_index('ix_tasks_owner_status_created')
        batch_op.create_index('ix_tasks_key_status_created', ['api_key_id', 'status', 'created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_tasks_api_key_id'), ['api_key_id'], unique=False)
        batch_op.create_unique_constraint('uq_tasks_key_idempotency', ['api_key_id', 'idempotency_key'])
        batch_op.alter_column('api_key_id',
               existing_type=sa.CHAR(length=32),
               nullable=False)
        batch_op.drop_column('owner_id')

    # ### end Alembic commands ###
