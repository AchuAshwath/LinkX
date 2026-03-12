from sqlmodel import Session, col, func, select

from app import crud
from app.models import Persona, Team, TeamMembership, UserCreate
from app.services.bootstrap import ensure_default_team_and_persona
from tests.utils.utils import random_email, random_lower_string


def test_default_team_and_persona_created_once(db: Session) -> None:
    user_in = UserCreate(email=random_email(), password=random_lower_string())
    user = crud.create_user(session=db, user_create=user_in)

    team1, persona1 = ensure_default_team_and_persona(session=db, user_id=user.id)
    db.commit()

    team2, persona2 = ensure_default_team_and_persona(session=db, user_id=user.id)
    db.commit()

    assert team1.id == team2.id
    assert persona1.id == persona2.id

    persona_count = db.exec(
        select(func.count())
        .select_from(Persona)
        .where(col(Persona.user_id) == user.id)
    ).one()
    assert persona_count == 1

    team_memberships = db.exec(
        select(TeamMembership).where(col(TeamMembership.user_id) == user.id)
    ).all()
    assert len(team_memberships) == 1
    assert team_memberships[0].team_id == team1.id
    assert team_memberships[0].role == "owner"

    team_count = db.exec(
        select(func.count())
        .select_from(Team)
        .where(col(Team.owner_user_id) == user.id)
    ).one()
    assert team_count == 1

