from pathlib import Path

import pytest
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import Post, SocialAccount, UserCreate
from app.services.linkedin_posts import LinkedInPostResult
from app.services.publishing import publish_post, resolve_image_path
from app.services.x_posts import XPostResult
from tests.utils.utils import random_email, random_lower_string


def test_resolve_image_path_variations(tmp_path: Path) -> None:
    # 1. Standard relative static uploads URL
    p1 = resolve_image_path(image_url="/static/uploads/banner_123.png")
    assert p1 == settings.UPLOAD_DIR / "banner_123.png"

    # 2. Full HTTP URL with query parameters
    p2 = resolve_image_path(
        image_url="http://localhost:8000/static/uploads/photo.jpg?v=2"
    )
    assert p2 == settings.UPLOAD_DIR / "photo.jpg"

    # 3. Direct filename
    p3 = resolve_image_path(image_url="test.gif")
    assert p3 == settings.UPLOAD_DIR / "test.gif"

    # 4. Direct existing absolute path
    test_file = tmp_path / "actual_existing.png"
    test_file.write_bytes(b"data")
    p4 = resolve_image_path(image_url=str(test_file))
    assert p4 == test_file


@pytest.mark.anyio
async def test_publish_x_with_media(
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = crud.create_user(
        session=db,
        user_create=UserCreate(email=random_email(), password=random_lower_string()),
    )

    media_file = settings.UPLOAD_DIR / "x_test_img.png"
    media_file.parent.mkdir(parents=True, exist_ok=True)
    media_file.write_bytes(b"fake x image bytes")

    post = Post(
        owner_id=user.id,
        content="Testing X media posting engine",
        image_url="/static/uploads/x_test_img.png",
        platform="x",
        status="draft",
    )
    db.add(post)
    db.commit()
    db.refresh(post)

    called_with: dict[str, object] = {}

    async def mock_create_media_post(
        _self: object,
        *,
        content: str,
        image_path: str,
        user_id: str | None = None,
        headless: bool | None = None,
    ) -> XPostResult:
        _ = headless
        called_with["content"] = content
        called_with["image_path"] = image_path
        called_with["user_id"] = user_id
        return XPostResult(
            success=True,
            post_id="9988776655",
            post_url="https://x.com/i/status/9988776655",
        )

    monkeypatch.setattr(
        "app.services.x_posts.XPostClient.create_media_post",
        mock_create_media_post,
    )

    try:
        failure = await publish_post(session=db, post=post)
        assert failure is None
        assert post.status == "published"
        assert post.external_post_id == "9988776655"
        assert post.published_at is not None
        assert called_with["content"] == "Testing X media posting engine"
        assert called_with["image_path"] == str(media_file)
    finally:
        if media_file.exists():
            media_file.unlink()


@pytest.mark.anyio
async def test_publish_x_with_missing_media_fails(
    db: Session,
) -> None:
    user = crud.create_user(
        session=db,
        user_create=UserCreate(email=random_email(), password=random_lower_string()),
    )

    post = Post(
        owner_id=user.id,
        content="Testing missing media failure",
        image_url="/static/uploads/non_existent_image_12345.png",
        platform="x",
        status="draft",
    )
    db.add(post)
    db.commit()
    db.refresh(post)

    failure = await publish_post(session=db, post=post)
    assert failure is not None
    assert post.status == "failed"
    assert post.error_code == "x_image_not_found"


@pytest.mark.anyio
async def test_publish_linkedin_with_media(
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = crud.create_user(
        session=db,
        user_create=UserCreate(email=random_email(), password=random_lower_string()),
    )

    account = SocialAccount(
        user_id=user.id,
        platform="linkedin",
        external_user_id="li_person_abc",
    )
    db.add(account)
    db.commit()

    media_file = settings.UPLOAD_DIR / "li_test_img.png"
    media_file.parent.mkdir(parents=True, exist_ok=True)
    media_file.write_bytes(b"fake li image bytes")

    post = Post(
        owner_id=user.id,
        content="Testing LinkedIn media posting engine",
        image_url="/static/uploads/li_test_img.png",
        platform="linkedin",
        status="draft",
    )
    db.add(post)
    db.commit()
    db.refresh(post)

    called_with: dict[str, object] = {}

    async def mock_create_image_post(
        _self: object,
        *,
        user_id: str | None = None,
        linkedin_person_id: str | None = None,
        content: str | None = None,
        image_bytes: bytes,
        content_type: str = "image/jpeg",
        _title: str | None = None,
        token: str | None = None,
        sub: str | None = None,
        text: str = "",
    ) -> LinkedInPostResult:
        _ = (content_type, _title, token, sub, text)
        called_with["user_id"] = user_id
        called_with["linkedin_person_id"] = linkedin_person_id
        called_with["content"] = content
        called_with["image_bytes"] = image_bytes
        return LinkedInPostResult(
            post_id="urn:li:share:media_li_888",
            image_urn="urn:li:image:img_888",
        )

    monkeypatch.setattr(
        "app.services.linkedin_posts.LinkedInPostClient.create_image_post",
        mock_create_image_post,
    )

    try:
        failure = await publish_post(session=db, post=post)
        assert failure is None
        assert post.status == "published"
        assert post.external_post_id == "urn:li:share:media_li_888"
        assert called_with["user_id"] == str(user.id)
        assert called_with["linkedin_person_id"] == "li_person_abc"
        assert called_with["image_bytes"] == b"fake li image bytes"
    finally:
        if media_file.exists():
            media_file.unlink()


@pytest.mark.anyio
async def test_publish_linkx_both_platforms_with_media(
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = crud.create_user(
        session=db,
        user_create=UserCreate(email=random_email(), password=random_lower_string()),
    )

    account = SocialAccount(
        user_id=user.id,
        platform="linkedin",
        external_user_id="li_both_user",
    )
    db.add(account)
    db.commit()

    media_file = settings.UPLOAD_DIR / "both_test_img.png"
    media_file.parent.mkdir(parents=True, exist_ok=True)
    media_file.write_bytes(b"dual platform image bytes")

    post = Post(
        owner_id=user.id,
        content="Cross-posting rich image to LinkedIn & X",
        image_url="/static/uploads/both_test_img.png",
        platform="linkx",
        status="draft",
    )
    db.add(post)
    db.commit()
    db.refresh(post)

    async def mock_create_image_post(_self: object, **_: object) -> LinkedInPostResult:
        return LinkedInPostResult(
            post_id="urn:li:share:dual_999",
            image_urn="urn:li:image:dual_img_999",
        )

    async def mock_create_media_post(_self: object, **_: object) -> XPostResult:
        return XPostResult(
            success=True,
            post_id="x_tweet_dual_777",
            post_url="https://x.com/i/status/x_tweet_dual_777",
        )

    monkeypatch.setattr(
        "app.services.linkedin_posts.LinkedInPostClient.create_image_post",
        mock_create_image_post,
    )
    monkeypatch.setattr(
        "app.services.x_posts.XPostClient.create_media_post",
        mock_create_media_post,
    )

    try:
        failure = await publish_post(session=db, post=post)
        assert failure is None
        assert post.status == "published"
        assert (
            post.external_post_id == "linkedin:urn:li:share:dual_999,x:x_tweet_dual_777"
        )
    finally:
        if media_file.exists():
            media_file.unlink()
