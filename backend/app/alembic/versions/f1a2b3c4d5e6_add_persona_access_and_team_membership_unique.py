"""Add persona_access table and unique team membership index.

Revision ID: f1a2b3c4d5e6
Revises: c3d4e5f6a7b8
Create Date: 2026-03-11
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f1a2b3c4d5e6"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "persona_access",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("persona_id", sa.Uuid(), nullable=False),
        sa.Column("team_id", sa.Uuid(), nullable=False),
        sa.Column("granted_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["persona_id"], ["persona.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["granted_by_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_persona_access_persona_team",
        "persona_access",
        ["persona_id", "team_id"],
        unique=True,
    )

    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_team_membership_team_user "
        "ON team_membership (team_id, user_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_team_membership_team_user")
    op.drop_index("ix_persona_access_persona_team", table_name="persona_access")
    op.drop_table("persona_access")
