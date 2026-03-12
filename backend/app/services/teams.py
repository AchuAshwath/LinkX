from __future__ import annotations

import uuid

from sqlmodel import Session, col, select

from app.models import Team, TeamMembership, User


def _default_team_name(*, user: User | None) -> str:
    if user:
        if user.full_name:
            full_name = user.full_name.strip()
            if full_name:
                return f"{full_name}'s Team"
        if user.email:
            email = user.email.strip()
            if email:
                return f"{email}'s Team"
    return "My Team"


def get_or_create_default_team_for_user(*, session: Session, user_id: uuid.UUID) -> Team:
    existing_team = session.exec(
        select(Team)
        .join(TeamMembership, col(TeamMembership.team_id) == col(Team.id))
        .where(col(TeamMembership.user_id) == user_id)
        .order_by(col(Team.created_at).asc().nulls_last())
    ).first()
    if existing_team:
        return existing_team

    user = session.get(User, user_id)
    name = _default_team_name(user=user)

    team = Team(owner_user_id=user_id, name=name, description=None)
    session.add(team)
    session.flush()

    membership = TeamMembership(user_id=user_id, team_id=team.id, role="owner")
    session.add(membership)
    session.flush()

    return team

