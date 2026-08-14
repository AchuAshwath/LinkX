"""Prune persona, team, and simplify post and social account models.

Revision ID: g1h2i3j4k5l6
Revises: f1a2b3c4d5e6
Create Date: 2026-08-14
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "g1h2i3j4k5l6"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Drop persona_access table
    op.execute("DROP TABLE IF EXISTS persona_access CASCADE")

    # 2. Drop team_membership and team tables
    op.execute("DROP TABLE IF EXISTS team_membership CASCADE")
    op.execute("DROP TABLE IF EXISTS team CASCADE")

    # 3. Clean up post table
    # Drop foreign key and column persona_id if they exist
    op.execute("ALTER TABLE post DROP CONSTRAINT IF EXISTS post_persona_id_fkey")
    op.execute("ALTER TABLE post DROP COLUMN IF EXISTS persona_id")
    # Add method column if not exists
    op.execute("ALTER TABLE post ADD COLUMN IF NOT EXISTS method VARCHAR(50) DEFAULT 'api' NOT NULL")

    # 4. Clean up social_account table
    op.execute("ALTER TABLE social_account DROP CONSTRAINT IF EXISTS social_account_persona_id_fkey")
    op.execute("ALTER TABLE social_account DROP COLUMN IF EXISTS persona_id")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_social_account_user_platform "
        "ON social_account (user_id, platform)"
    )

    # 5. Drop persona table
    op.execute("DROP TABLE IF EXISTS persona CASCADE")


def downgrade() -> None:
    pass
