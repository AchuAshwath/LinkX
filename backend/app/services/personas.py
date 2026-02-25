from __future__ import annotations

import uuid
from typing import Optional

from sqlmodel import Session, select

from app.models import Persona, User


def _default_persona_name(
    *, user: Optional[User], display_name_hint: Optional[str]
) -> str:
    if display_name_hint:
        name = display_name_hint.strip()
        if name:
            return name

    if user:
        if user.full_name:
            full_name = user.full_name.strip()
            if full_name:
                return full_name
        if user.email:
            email = user.email.strip()
            if email:
                return email

    return "Persona"


def get_or_create_persona_for_user(
    *,
    session: Session,
    user_id: uuid.UUID,
    display_name_hint: Optional[str] = None,
) -> Persona:
    """Return an existing Persona for the user or create a new one.

    This centralizes persona creation so that all features (LinkedIn, future
    platforms, teams, etc.) share the same mapping from user -> default persona.
    """
    existing = session.exec(
        select(Persona).where(Persona.user_id == user_id)
    ).first()
    if existing:
        return existing

    user = session.get(User, user_id)
    name = _default_persona_name(user=user, display_name_hint=display_name_hint)

    persona = Persona(user_id=user_id, name=name, description=None)
    session.add(persona)
    # Flush so that persona.id is available to the caller without committing.
    session.flush()
    return persona

