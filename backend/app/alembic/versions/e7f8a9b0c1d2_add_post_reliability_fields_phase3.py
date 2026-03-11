"""Add post reliability fields for phase 3.

Revision ID: e7f8a9b0c1d2
Revises: f1a2b3c4d5e6
Create Date: 2026-03-11
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e7f8a9b0c1d2"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "post",
        sa.Column("publishing_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "post",
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "post",
        sa.Column("last_retry_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "post",
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "post",
        sa.Column("error_code", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "post",
        sa.Column("error_message", sa.String(length=1000), nullable=True),
    )

    op.alter_column("post", "retry_count", server_default=None)

    op.create_index(
        "ix_post_persona_status_scheduled_at",
        "post",
        ["persona_id", "status", "scheduled_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_post_persona_status_scheduled_at", table_name="post")

    op.drop_column("post", "error_message")
    op.drop_column("post", "error_code")
    op.drop_column("post", "next_retry_at")
    op.drop_column("post", "last_retry_at")
    op.drop_column("post", "retry_count")
    op.drop_column("post", "publishing_started_at")
