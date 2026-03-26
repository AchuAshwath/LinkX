"""Backfill persona_id on social_account rows that are missing it.

Revision ID: c3d4e5f6a7b8
Revises: a1b2c3d4e5f6
Create Date: 2026-02-25
"""

from datetime import datetime
from typing import Dict

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c3d4e5f6a7b8"
down_revision = "b1c2d3e4f5g6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Ensure all social_account rows have a persona_id.

    This is a safety net in case any rows were created while persona_id
    was nullable or before application code was updated to always set it.
    """
    bind = op.get_bind()
    metadata = sa.MetaData()
    metadata.bind = bind

    user = sa.Table("user", metadata, autoload_with=bind)
    persona = sa.Table("persona", metadata, autoload_with=bind)
    social_account = sa.Table("social_account", metadata, autoload_with=bind)

    # Cache mapping user_id -> persona_id to avoid repeated queries.
    user_to_persona: Dict[str, str] = {}

    def get_or_create_persona_for_user(user_id: str) -> str:
        if user_id in user_to_persona:
            return user_to_persona[user_id]

        # Prefer an existing persona for this user if it already exists.
        existing_persona_id = bind.execute(
            sa.select(persona.c.id).where(persona.c.user_id == user_id)
        ).scalar_one_or_none()
        if existing_persona_id is not None:
            persona_id = str(existing_persona_id)
            user_to_persona[user_id] = persona_id
            return persona_id

        # Fall back to creating a new persona, similar to the original migration.
        user_row = bind.execute(
            sa.select(user.c.id, user.c.full_name, user.c.email).where(
                user.c.id == user_id
            )
        ).scalar_one_or_none()

        if user_row is None:
            display_name = "Unknown"
        else:
            full_name = getattr(user_row, "full_name", None)
            email = getattr(user_row, "email", None)
            display_name = full_name or email or "Persona"

        import uuid  # Imported here to keep scope local to the migration

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

    # Backfill only rows where persona_id is currently NULL.
    sa_rows = bind.execute(
        sa.select(
            social_account.c.id,
            social_account.c.user_id,
            social_account.c.persona_id,
        ).where(social_account.c.persona_id.is_(None))
    ).all()

    for row in sa_rows:
        user_id = str(row.user_id)
        persona_id = get_or_create_persona_for_user(user_id)
        bind.execute(
            social_account.update()
            .where(social_account.c.id == row.id)
            .values(persona_id=persona_id)
        )


def downgrade() -> None:
    """Best-effort downgrade: unset persona_id for rows that were backfilled.

    This does not try to delete created personas because they might now be
    referenced by posts or other relations.
    """
    bind = op.get_bind()
    metadata = sa.MetaData()
    metadata.bind = bind

    social_account = sa.Table("social_account", metadata, autoload_with=bind)

    # Setting persona_id to NULL will only succeed if the column is nullable.
    # If a NOT NULL constraint is present, Alembic/users would need to relax
    # it separately before running this downgrade.
    bind.execute(
        social_account.update()
        .where(social_account.c.persona_id.isnot(None))
        .values(persona_id=None)
    )
