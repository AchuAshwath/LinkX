"""Add updated_at to user and item tables.

Revision ID: b1c2d3e4f5g6
Revises: a1b2c3d4e5f6
Create Date: 2026-02-03
"""

from datetime import datetime

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b1c2d3e4f5g6"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add updated_at columns as nullable
    op.add_column(
        "user",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "item",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    # 2. Backfill updated_at = created_at (or now() if missing)
    bind = op.get_bind()
    metadata = sa.MetaData()
    metadata.bind = bind

    user = sa.Table("user", metadata, autoload_with=bind)
    item = sa.Table("item", metadata, autoload_with=bind)

    now = datetime.utcnow()

    bind.execute(
        user.update().values(
            updated_at=sa.case(
                (user.c.created_at.isnot(None), user.c.created_at),
                else_=now,
            )
        )
    )
    bind.execute(
        item.update().values(
            updated_at=sa.case(
                (item.c.created_at.isnot(None), item.c.created_at),
                else_=now,
            )
        )
    )

    # 3. Make updated_at non-nullable
    op.alter_column(
        "user",
        "updated_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
    )
    op.alter_column(
        "item",
        "updated_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
    )


def downgrade() -> None:
    op.drop_column("item", "updated_at")
    op.drop_column("user", "updated_at")
