from __future__ import annotations

import uuid

from sqlmodel import Session, select

from app.models import Persona, PersonaAccess, TeamMembership

ROLE_PRIORITY: dict[str, int] = {
    "member": 1,
    "admin": 2,
    "owner": 3,
}


def normalize_role(*, role: str) -> str:
    cleaned = role.strip().lower()
    return cleaned


def highest_role(*, roles: list[str]) -> str | None:
    if not roles:
        return None
    valid_roles = [
        normalize_role(role=role)
        for role in roles
        if normalize_role(role=role) in ROLE_PRIORITY
    ]
    if not valid_roles:
        return None
    return max(valid_roles, key=lambda r: ROLE_PRIORITY.get(r, 0))


def get_team_role(
    *, session: Session, team_id: uuid.UUID, user_id: uuid.UUID
) -> str | None:
    membership = session.exec(
        select(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.user_id == user_id,
        )
    ).first()
    if not membership:
        return None
    return normalize_role(role=membership.role)


def get_persona_role(
    *, session: Session, persona_id: uuid.UUID, user_id: uuid.UUID
) -> str | None:
    persona = session.get(Persona, persona_id)
    if not persona:
        return None
    if persona.user_id == user_id:
        return "owner"

    rows = session.exec(
        select(PersonaAccess.role)
        .join(TeamMembership, PersonaAccess.team_id == TeamMembership.team_id)
        .where(
            PersonaAccess.persona_id == persona_id,
            TeamMembership.user_id == user_id,
        )
    ).all()
    roles = [normalize_role(role=row) for row in rows]
    return highest_role(roles=roles)


def has_min_role(*, role: str, minimum: str) -> bool:
    return ROLE_PRIORITY.get(normalize_role(role=role), 0) >= ROLE_PRIORITY.get(
        normalize_role(role=minimum), 0
    )
