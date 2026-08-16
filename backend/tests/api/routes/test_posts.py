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


def test_publish_x_platform(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, headers = _create_user_with_auth(client=client, db=db)
    post = Post(
        owner_id=user.id,
        content="publish to x only",
        platform="x",
        status="draft",
    )
    db.add(post)
    db.commit()
    db.refresh(post)

    called_x = False

    async def _mock_create_x_post(_self: object, **_: str) -> str:
        nonlocal called_x
        called_x = True
        return "tweet_123456789"

    monkeypatch.setattr(
        "app.services.x_posts.XPostClient.create_text_post",
        _mock_create_x_post,
    )

    response = client.post(
        f"{settings.API_V1_STR}/posts/{post.id}/publish",
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "published"
    assert data["external_post_id"] == "tweet_123456789"
    assert called_x is True


def test_publish_linkx_both_platforms(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, headers = _create_user_with_auth(client=client, db=db)
    post = Post(
        owner_id=user.id,
        content="publish to both linkedin and x",
        platform="linkx",
        status="draft",
    )
    db.add(post)
    account = SocialAccount(
        user_id=user.id,
        platform="linkedin",
        external_user_id="abc123",
    )
    db.add(account)
    db.commit()
    db.refresh(post)

    called_linkedin = False
    called_x = False

    async def _mock_create_linkedin_post(_self: object, **_: str) -> str:
        nonlocal called_linkedin
        called_linkedin = True
        return "urn:li:share:111"

    async def _mock_create_x_post(_self: object, **_: str) -> str:
        nonlocal called_x
        called_x = True
        return "tweet_222"

    monkeypatch.setattr(
        "app.services.linkedin_posts.LinkedInPostClient.create_text_post",
        _mock_create_linkedin_post,
    )
    monkeypatch.setattr(
        "app.services.x_posts.XPostClient.create_text_post",
        _mock_create_x_post,
    )

    response = client.post(
        f"{settings.API_V1_STR}/posts/{post.id}/publish",
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "published"
    assert data["external_post_id"] == "linkedin:urn:li:share:111,x:tweet_222"
    assert called_linkedin is True
    assert called_x is True


def test_upload_media_success(
    client: TestClient,
    db: Session,
) -> None:
    _user, headers = _create_user_with_auth(client=client, db=db)
    file_bytes = b"\x89PNG\r\n\x1a\nfakeimagecontent"
    response = client.post(
        f"{settings.API_V1_STR}/posts/media",
        headers=headers,
        files={"file": ("photo.png", file_bytes, "image/png")},
    )
    assert response.status_code == 200
    data = response.json()
    assert "url" in data
    assert data["url"].startswith("/static/uploads/")
    assert data["content_type"] == "image/png"
    assert data["size_bytes"] == len(file_bytes)
    assert data["filename"].endswith(".png")

    # Verify static file is accessible
    static_resp = client.get(data["url"])
    assert static_resp.status_code == 200
    assert static_resp.content == file_bytes


def test_upload_media_invalid_mime(
    client: TestClient,
    db: Session,
) -> None:
    _user, headers = _create_user_with_auth(client=client, db=db)
    response = client.post(
        f"{settings.API_V1_STR}/posts/media",
        headers=headers,
        files={"file": ("document.pdf", b"%PDF-1.4...", "application/pdf")},
    )
    assert response.status_code == 400
    assert "Invalid file type" in response.json()["detail"]


def test_upload_media_oversized_file(
    client: TestClient,
    db: Session,
) -> None:
    _user, headers = _create_user_with_auth(client=client, db=db)
    large_bytes = b"0" * (5 * 1024 * 1024 + 1)
    response = client.post(
        f"{settings.API_V1_STR}/posts/media",
        headers=headers,
        files={"file": ("large.jpg", large_bytes, "image/jpeg")},
    )
    assert response.status_code == 413
    assert "File size exceeds maximum limit" in response.json()["detail"]


def test_generate_ai_draft_success(
    client: TestClient,
    db: Session,
) -> None:
    _user, headers = _create_user_with_auth(client=client, db=db)
    response = client.post(
        f"{settings.API_V1_STR}/posts/ai-draft",
        headers=headers,
        json={"prompt": "NextGen AI Agents", "platform": "x"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "content" in data
    assert len(data["content"]) > 10
    assert "NextGen AI Agents" in data["content"]


def test_generate_ai_draft_empty_prompt(
    client: TestClient,
    db: Session,
) -> None:
    _user, headers = _create_user_with_auth(client=client, db=db)
    response = client.post(
        f"{settings.API_V1_STR}/posts/ai-draft",
        headers=headers,
        json={"prompt": "", "platform": "linkedin"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "content" in data
    assert len(data["content"]) > 10
