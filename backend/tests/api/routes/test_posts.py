import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import Persona, Post, User, UserCreate
from tests.utils.user import user_authentication_headers
from tests.utils.utils import random_email, random_lower_string


def _create_user_with_auth(
    *, client: TestClient, db: Session
) -> tuple[User, dict[str, str]]:
    email = random_email()
    password = random_lower_string()
    user = crud.create_user(
        session=db, user_create=UserCreate(email=email, password=password)
    )
    headers = user_authentication_headers(client=client, email=email, password=password)
    return user, headers


def _create_persona(*, db: Session, user: User, name: str) -> Persona:
    persona = Persona(user_id=user.id, name=name, description=None)
    db.add(persona)
    db.commit()
    db.refresh(persona)
    return persona


def _create_post(
    *, db: Session, owner_id: uuid.UUID, persona_id: uuid.UUID, content: str
) -> Post:
    post = Post(
        owner_id=owner_id,
        persona_id=persona_id,
        content=content,
        platform="linkedin",
        status="draft",
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return post


def test_read_posts_requires_persona_id(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/posts",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "persona_id is required"


def test_create_post_requires_persona_id(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/posts",
        headers=normal_user_token_headers,
        json={
            "content": "hello",
            "platform": "linkedin",
            "status": "draft",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "persona_id is required"


def test_read_posts_scoped_to_persona(
    client: TestClient,
    db: Session,
) -> None:
    user, headers = _create_user_with_auth(client=client, db=db)
    persona_one = _create_persona(db=db, user=user, name="One")
    persona_two = _create_persona(db=db, user=user, name="Two")

    _create_post(db=db, owner_id=user.id, persona_id=persona_one.id, content="first")
    _create_post(db=db, owner_id=user.id, persona_id=persona_two.id, content="second")

    response = client.get(
        f"{settings.API_V1_STR}/posts",
        headers=headers,
        params={"persona_id": str(persona_one.id)},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 1
    assert data[0]["persona_id"] == str(persona_one.id)
    assert data[0]["content"] == "first"


def test_read_posts_forbidden_without_access(
    client: TestClient,
    db: Session,
) -> None:
    owner, _ = _create_user_with_auth(client=client, db=db)
    other_user, other_headers = _create_user_with_auth(client=client, db=db)
    persona = _create_persona(db=db, user=owner, name="Owner Persona")

    response = client.get(
        f"{settings.API_V1_STR}/posts",
        headers=other_headers,
        params={"persona_id": str(persona.id)},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Not enough permissions"


def test_create_published_post_requires_linkedin_for_persona(
    client: TestClient,
    db: Session,
) -> None:
    user, headers = _create_user_with_auth(client=client, db=db)
    persona = _create_persona(db=db, user=user, name="Publish Persona")

    response = client.post(
        f"{settings.API_V1_STR}/posts",
        headers=headers,
        json={
            "persona_id": str(persona.id),
            "content": "publish me",
            "platform": "linkedin",
            "status": "published",
        },
    )
    assert response.status_code == 400
    assert (
        response.json()["detail"] == "LinkedIn account not connected for this persona"
    )
