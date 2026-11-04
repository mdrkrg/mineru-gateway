"""unique lowercase email identity

Revision ID: 8f3b2c1d4e70
Revises: d269a836066a
Create Date: 2026-11-04 11:40:00.000000

fastapi-users' ``SQLAlchemyUserDatabase.get_by_email`` compares
``lower(email) = lower(?)``. ``users.email`` was only unique on the raw string,
so two rows could differ by case alone; every email lookup then raised
``MultipleResultsFound``. This expression index enforces the same predicate the
queries use and lets them be index-backed.

Expression indexes are not reflected by alembic autogenerate, so this migration
is hand-written on purpose. Any future batch rebuild of ``users`` must re-create
the index explicitly.

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8f3b2c1d4e70'
down_revision: Union[str, Sequence[str], None] = 'd269a836066a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEX_NAME = 'uq_users_email_lower'


def upgrade() -> None:
    """Upgrade schema."""
    # Fail closed: a database that already holds case variants cannot take the
    # unique index, and must be resolved by hand instead of silently dropping
    # rows.
    bind = op.get_bind()
    duplicates = bind.execute(
        sa.text(
            'SELECT lower(email) AS email, count(*) AS n FROM users '
            'GROUP BY lower(email) HAVING count(*) > 1'
        )
    ).fetchall()
    if duplicates:
        listing = ', '.join(f'{row.email} x{row.n}' for row in duplicates)
        raise RuntimeError(
            'users table holds case-variant duplicates of the same email, '
            f'resolve before migrating: {listing}'
        )

    op.create_index(INDEX_NAME, 'users', [sa.text('lower(email)')], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(INDEX_NAME, table_name='users')
