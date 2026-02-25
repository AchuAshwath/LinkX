from sqlmodel import Session

from app import crud
from app.models import Persona, UserCreate
from app.services.personas import get_or_create_persona_for_user
from tests.utils.utils import random_email, random_lower_string


def test_get_or_create_persona_creates(db: Session) -> None:
    email = random_email()
    password = random_lower_string()
    user_in = UserCreate(email=email, password=password)
    user = crud.create_user(session=db, user_create=user_in)

    display_name = "My Persona Name"
    persona = get_or_create_persona_for_user(
        session=db,
        user_id=user.id,
        display_name_hint=display_name,
    )

    assert isinstance(persona, Persona)
    assert persona.user_id == user.id
    assert persona.name == display_name


def test_get_or_create_persona_reuses_existing(db: Session) -> None:
    email = random_email()
    password = random_lower_string()
    user_in = UserCreate(email=email, password=password)
    user = crud.create_user(session=db, user_create=user_in)

    first = get_or_create_persona_for_user(
        session=db,
        user_id=user.id,
        display_name_hint="First Name",
    )
    second = get_or_create_persona_for_user(
        session=db,
        user_id=user.id,
        display_name_hint="Second Name",
    )

    assert first.id == second.id
    # Name should remain the one from the first creation.
    assert second.name == first.name == "First Name"

