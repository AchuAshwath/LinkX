import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import (
    Persona,
    PersonaAccess,
    Post,
    SocialAccount,
    Team,
    TeamMembership,
    User,
    UserCreate,
)
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


def _grant_persona_role_via_team(
    *, db: Session, owner: User, target_user: User, persona: Persona, role: str
) -> None:
    team = Team(owner_user_id=owner.id, name="role-team", description=None)
    db.add(team)
    db.commit()
    db.refresh(team)

    db.add(
        TeamMembership(
            user_id=target_user.id,
            team_id=team.id,
            role=role,
        )
    )
    db.add(
        PersonaAccess(
            persona_id=persona.id,
            team_id=team.id,
            granted_by_user_id=owner.id,
            role=role,
        )
    )
    db.commit()


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
    assert response.status_code == 422
    errors = response.json()["detail"]
    assert isinstance(errors, list)
    assert any(
        err.get("type") == "missing" and err.get("loc") == ["body", "persona_id"]
        for err in errors
    )


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
    detail = response.json()["detail"]
    assert detail["error"] == "linkedin_not_connected"
    assert detail["message"] == "LinkedIn account not connected for this persona"
    assert detail["retryable"] is False
    assert isinstance(detail["trace_id"], str)


def test_update_post_rejects_invalid_transition(
    client: TestClient,
    db: Session,
) -> None:
    user, headers = _create_user_with_auth(client=client, db=db)
    persona = _create_persona(db=db, user=user, name="Transition Persona")
    post = _create_post(
        db=db,
        owner_id=user.id,
        persona_id=persona.id,
        content="transition test",
    )

    response = client.patch(
        f"{settings.API_V1_STR}/posts/{post.id}",
        headers=headers,
        json={"status": "failed"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid transition: draft -> failed"


def test_retry_requires_failed_status(
    client: TestClient,
    db: Session,
) -> None:
    user, headers = _create_user_with_auth(client=client, db=db)
    persona = _create_persona(db=db, user=user, name="Retry Persona")
    post = _create_post(
        db=db,
        owner_id=user.id,
        persona_id=persona.id,
        content="retry test",
    )

    response = client.post(
        f"{settings.API_V1_STR}/posts/{post.id}/retry",
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Only failed posts can be retried"


def test_publish_endpoint_member_is_forbidden(
    client: TestClient,
    db: Session,
) -> None:
    owner, _ = _create_user_with_auth(client=client, db=db)
    member, member_headers = _create_user_with_auth(client=client, db=db)
    persona = _create_persona(db=db, user=owner, name="Owner Persona")
    post = _create_post(db=db, owner_id=owner.id, persona_id=persona.id, content="test")

    _grant_persona_role_via_team(
        db=db,
        owner=owner,
        target_user=member,
        persona=persona,
        role="member",
    )

    response = client.post(
        f"{settings.API_V1_STR}/posts/{post.id}/publish",
        headers=member_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Members can create and edit drafts only"


def test_retry_endpoint_member_is_forbidden(
    client: TestClient,
    db: Session,
) -> None:
    owner, owner_headers = _create_user_with_auth(client=client, db=db)
    member, member_headers = _create_user_with_auth(client=client, db=db)
    persona = _create_persona(db=db, user=owner, name="Owner Persona")

    _grant_persona_role_via_team(
        db=db,
        owner=owner,
        target_user=member,
        persona=persona,
        role="member",
    )

    post = _create_post(db=db, owner_id=owner.id, persona_id=persona.id, content="test")

    owner_response = client.patch(
        f"{settings.API_V1_STR}/posts/{post.id}",
        headers=owner_headers,
        json={"status": "published"},
    )
    assert owner_response.status_code == 400

    db.refresh(post)
    post.status = "failed"
    db.add(post)
    db.commit()

    response = client.post(
        f"{settings.API_V1_STR}/posts/{post.id}/retry",
        headers=member_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Members cannot retry posts"


def test_publish_endpoint_is_idempotent_when_external_id_exists(
    client: TestClient,
    db: Session,
    monkeypatch,
) -> None:
    user, headers = _create_user_with_auth(client=client, db=db)
    persona = _create_persona(db=db, user=user, name="Persona")
    post = _create_post(
        db=db, owner_id=user.id, persona_id=persona.id, content="idempotent"
    )

    post.status = "published"
    post.external_post_id = "urn:li:share:123"
    db.add(post)
    db.commit()

    async def _raise_if_called(_self: object, **_: str) -> str:
        raise AssertionError("LinkedIn client should not be called")

    monkeypatch.setattr(
        "app.services.linkedin_posts.LinkedInPostClient.create_text_post",
        _raise_if_called,
    )

    response = client.post(
        f"{settings.API_V1_STR}/posts/{post.id}/publish",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["status"] == "published"
    assert response.json()["external_post_id"] == "urn:li:share:123"


def test_publish_endpoint_success_updates_phase3_fields(
    client: TestClient,
    db: Session,
    monkeypatch,
) -> None:
    user, headers = _create_user_with_auth(client=client, db=db)
    persona = _create_persona(db=db, user=user, name="Persona")
    post = _create_post(
        db=db, owner_id=user.id, persona_id=persona.id, content="publish"
    )

    account = SocialAccount(
        user_id=user.id,
        persona_id=persona.id,
        platform="linkedin",
        external_user_id="abc123",
    )
    db.add(account)
    db.commit()

    async def _mock_create_text_post(_self: object, **_: str) -> str:
        return "urn:li:share:999"

    monkeypatch.setattr(
        "app.services.linkedin_posts.LinkedInPostClient.create_text_post",
        _mock_create_text_post,
    )

    response = client.post(
        f"{settings.API_V1_STR}/posts/{post.id}/publish",
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "published"
    assert data["external_post_id"] == "urn:li:share:999"
    assert data["publishing_started_at"] is not None
    assert data["published_at"] is not None
    assert data["error_code"] is None
    assert data["error_message"] is None
