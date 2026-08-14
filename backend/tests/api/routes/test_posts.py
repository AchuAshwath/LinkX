import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import (
    Post,
    SocialAccount,
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


def _create_post(*, db: Session, owner_id: uuid.UUID, content: str) -> Post:
    post = Post(
        owner_id=owner_id,
        content=content,
        platform="linkedin",
        status="draft",
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return post


def test_read_posts_scoped_to_user(
    client: TestClient,
    db: Session,
) -> None:
    user_one, headers_one = _create_user_with_auth(client=client, db=db)
    user_two, _headers_two = _create_user_with_auth(client=client, db=db)

    _create_post(db=db, owner_id=user_one.id, content="first")
    _create_post(db=db, owner_id=user_two.id, content="second")

    response = client.get(
        f"{settings.API_V1_STR}/posts",
        headers=headers_one,
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 1
    assert data[0]["content"] == "first"
    assert data[0]["owner_id"] == str(user_one.id)


def test_read_posts_forbidden_without_access(
    client: TestClient,
    db: Session,
) -> None:
    owner, _ = _create_user_with_auth(client=client, db=db)
    other_user, other_headers = _create_user_with_auth(client=client, db=db)
    post = _create_post(db=db, owner_id=owner.id, content="private post")

    response = client.get(
        f"{settings.API_V1_STR}/posts/{post.id}",
        headers=other_headers,
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Post not found"


def test_create_published_post_requires_linkedin(
    client: TestClient,
    db: Session,
) -> None:
    user, headers = _create_user_with_auth(client=client, db=db)

    response = client.post(
        f"{settings.API_V1_STR}/posts",
        headers=headers,
        json={
            "content": "publish me",
            "platform": "linkedin",
            "status": "published",
        },
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["error"] == "linkedin_not_connected"
    assert detail["message"] == "LinkedIn account not connected for this user"
    assert detail["retryable"] is False
    assert isinstance(detail["trace_id"], str)


def test_update_post_rejects_invalid_transition(
    client: TestClient,
    db: Session,
) -> None:
    user, headers = _create_user_with_auth(client=client, db=db)
    post = _create_post(
        db=db,
        owner_id=user.id,
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
    post = _create_post(
        db=db,
        owner_id=user.id,
        content="retry test",
    )

    response = client.post(
        f"{settings.API_V1_STR}/posts/{post.id}/retry",
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Only failed posts can be retried"


def test_publish_endpoint_is_idempotent_when_external_id_exists(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, headers = _create_user_with_auth(client=client, db=db)
    post = _create_post(db=db, owner_id=user.id, content="idempotent")

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
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, headers = _create_user_with_auth(client=client, db=db)
    post = _create_post(db=db, owner_id=user.id, content="publish")

    account = SocialAccount(
        user_id=user.id,
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
