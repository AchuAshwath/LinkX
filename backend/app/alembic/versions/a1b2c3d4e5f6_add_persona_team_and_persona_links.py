"""Add persona, team, and persona-based ownership for posts and social accounts.

Revision ID: a1b2c3d4e5f6
Revises: merge_7f3b_fe56
Create Date: 2026-02-03
"""

from collections import defaultdict
from datetime import datetime

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "merge_7f3b_fe56"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create persona table
    op.create_table(
        "persona",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # 2. Create team and team_membership tables (future-ready)
    op.create_table(
        "team",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "team_membership",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("team_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=False, server_default="member"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["team.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # 3. Add persona_id columns to post and social_account
    op.add_column("post", sa.Column("persona_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "post_persona_id_fkey",
        "post",
        "persona",
        ["persona_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.add_column("social_account", sa.Column("persona_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "social_account_persona_id_fkey",
        "social_account",
        "persona",
        ["persona_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # 4. Data migration: create default personas per user and backfill persona_id
    bind = op.get_bind()
    metadata = sa.MetaData()
    metadata.bind = bind

    user = sa.Table("user", metadata, autoload_with=bind)
    post = sa.Table("post", metadata, autoload_with=bind)
    social_account = sa.Table("social_account", metadata, autoload_with=bind)
    persona = sa.Table("persona", metadata, autoload_with=bind)

    # Map user_id -> persona_id
    user_to_persona: dict[str, str] = {}

    def get_or_create_persona_for_user(user_id: str) -> str:
        if user_id in user_to_persona:
            return user_to_persona[user_id]

        user_row = bind.execute(
            sa.select(user.c.id, user.c.full_name, user.c.email).where(
                user.c.id == user_id
            )
        ).scalar_one_or_none()

        if user_row is None:
            # Should not happen, but guard against missing users
            display_name = "Unknown"
        else:
            full_name = getattr(user_row, "full_name", None)
            email = getattr(user_row, "email", None)
            display_name = full_name or email or "Persona"

        new_persona_id = str(uuid.uuid4())
        now = datetime.utcnow()
        bind.execute(
            persona.insert().values(
                id=new_persona_id,
                user_id=user_id,
                name=display_name,
                description=None,
                created_at=now,
                updated_at=now,
            )
        )
        user_to_persona[user_id] = new_persona_id
        return new_persona_id

    import uuid  # Imported here to avoid polluting module namespace unnecessarily

    # Backfill posts
    post_rows = bind.execute(
        sa.select(post.c.id, post.c.owner_id, post.c.persona_id)
    ).all()
    for row in post_rows:
        if row.persona_id is not None:
            continue
        owner_id = str(row.owner_id)
        persona_id = get_or_create_persona_for_user(owner_id)
        bind.execute(
            post.update()
            .where(post.c.id == row.id)
            .values(persona_id=persona_id)
        )

    # Backfill social accounts
    sa_rows = bind.execute(
        sa.select(social_account.c.id, social_account.c.user_id, social_account.c.persona_id)
    ).all()
    for row in sa_rows:
        if row.persona_id is not None:
            continue
        user_id = str(row.user_id)
        persona_id = get_or_create_persona_for_user(user_id)
        bind.execute(
            social_account.update()
            .where(social_account.c.id == row.id)
            .values(persona_id=persona_id)
        )

    # 5. Tighten constraints: persona_id non-nullable and adjust indexes
    op.alter_column(
        "post",
        "persona_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )

    op.alter_column(
        "social_account",
        "persona_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )

    # Switch unique constraint from (user_id, platform) to (persona_id, platform)
    op.drop_index(
        op.f("ix_social_account_user_platform"),
        table_name="social_account",
    )
    op.create_index(
        "ix_social_account_persona_platform",
        "social_account",
        ["persona_id", "platform"],
        unique=True,
    )


def downgrade() -> None:
    # Reverse index change on social_account
    op.drop_index(
        "ix_social_account_persona_platform",
        table_name="social_account",
    )
    op.create_index(
        op.f("ix_social_account_user_platform"),
        "social_account",
        ["user_id", "platform"],
        unique=True,
    )

    # Make persona_id nullable again and drop FKs/columns
    op.alter_column(
        "social_account",
        "persona_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )
    op.drop_constraint(
        "social_account_persona_id_fkey",
        "social_account",
        type_="foreignkey",
    )
    op.drop_column("social_account", "persona_id")

    op.alter_column(
        "post",
        "persona_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )
    op.drop_constraint(
        "post_persona_id_fkey",
        "post",
        type_="foreignkey",
    )
    op.drop_column("post", "persona_id")

    # Drop team-related tables
    op.drop_table("team_membership")
    op.drop_table("team")

    # Drop persona table
    op.drop_table("persona")

