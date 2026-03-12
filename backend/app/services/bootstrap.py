from __future__ import annotations

import uuid

from sqlmodel import Session

from app.models import Persona, Team
from app.services.personas import get_or_create_persona_for_user
from app.services.teams import get_or_create_default_team_for_user


def ensure_default_team_and_persona(
    *, session: Session, user_id: uuid.UUID
) -> tuple[Team, Persona]:
    team = get_or_create_default_team_for_user(session=session, user_id=user_id)
    persona = get_or_create_persona_for_user(session=session, user_id=user_id)
    return team, persona

