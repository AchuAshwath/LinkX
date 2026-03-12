from __future__ import annotations

import uuid

from sqlmodel import Session, select

from app.models import Persona, PersonaAccess, Team
from app.services.personas import get_or_create_persona_for_user
from app.services.teams import get_or_create_default_team_for_user


def ensure_default_team_and_persona(
    *, session: Session, user_id: uuid.UUID
) -> tuple[Team, Persona]:
    team = get_or_create_default_team_for_user(session=session, user_id=user_id)
    persona = get_or_create_persona_for_user(session=session, user_id=user_id)
    # Ensure the default persona is shared with the default team as owner
    existing_access = session.exec(
        select(PersonaAccess).where(
            PersonaAccess.persona_id == persona.id,
            PersonaAccess.team_id == team.id,
        )
    ).first()
    if not existing_access:
        access = PersonaAccess(
            persona_id=persona.id,
            team_id=team.id,
            granted_by_user_id=user_id,
            role="owner",
        )
        session.add(access)
        session.flush()
    return team, persona

