"""add external_post_id to post

Revision ID: 7f3b2c1d4e89
Revises: 6f2e9c4b1a7d
Create Date: 2026-01-29 09:20:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "7f3b2c1d4e89"
down_revision = "6f2e9c4b1a7d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "post",
        sa.Column("external_post_id", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("post", "external_post_id")
