"""merge heads: post/social_account branch and created_at branch

Revision ID: merge_7f3b_fe56
Revises: 7f3b2c1d4e89, fe56fa70289e
Create Date: 2026-01-31

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "merge_7f3b_fe56"
down_revision = ("7f3b2c1d4e89", "fe56fa70289e")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
