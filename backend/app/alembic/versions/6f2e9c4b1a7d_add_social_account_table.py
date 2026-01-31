"""add social_account table

Revision ID: 6f2e9c4b1a7d
Revises: 518198dae943
Create Date: 2026-01-29

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "6f2e9c4b1a7d"
down_revision = "518198dae943"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "social_account",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("platform", sa.String(length=50), nullable=False),
        sa.Column("external_user_id", sa.String(length=255), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("profile_picture_url", sa.String(length=1024), nullable=True),
        sa.Column("raw_profile", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_social_account_platform"),
        "social_account",
        ["platform"],
        unique=False,
    )
    op.create_index(
        op.f("ix_social_account_user_platform"),
        "social_account",
        ["user_id", "platform"],
        unique=True,
    )


def downgrade():
    op.drop_index(op.f("ix_social_account_user_platform"), table_name="social_account")
    op.drop_index(op.f("ix_social_account_platform"), table_name="social_account")
    op.drop_table("social_account")

