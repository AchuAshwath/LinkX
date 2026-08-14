"""Prune persona, team, and simplify post and social account models.

Revision ID: g1h2i3j4k5l6
Revises: 6897d7db30a5
Create Date: 2026-08-14
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "g1h2i3j4k5l6"
down_revision = "6897d7db30a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Drop persona_access table & indices
    op.execute("DROP INDEX IF EXISTS ix_persona_access_persona_team")
    op.execute("DROP TABLE IF EXISTS persona_access CASCADE")

    # 2. Drop team_membership and team tables & indices
    op.execute("DROP INDEX IF EXISTS ix_team_membership_team_user")
    op.execute("DROP TABLE IF EXISTS team_membership CASCADE")
    op.execute("DROP TABLE IF EXISTS team CASCADE")

    # 3. Clean up post table
    # Drop legacy persona index, foreign key, and column if they exist
    op.execute("DROP INDEX IF EXISTS ix_post_persona_status_scheduled_at")
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
