"""Tests for Persistence and Verification Agentic Tools."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlmodel import Session

from app import crud
from app.models import User, UserCreate
from app.services.agentic.tools.persistence_tools import (
    delete_post_from_db,
    publish_post_live,
    save_draft_post,
    schedule_post_in_db,
    update_post_in_db,
)
from app.services.agentic.tools.verification_tools import (
    _calculate_token_overlap,
    _fuzzy_text_match,
    verify_post_on_live_profile,
    verify_post_url_status,
)
from tests.utils.utils import random_email, random_lower_string


def _make_user(*, db: Session) -> User:
    return crud.create_user(
        session=db,
        user_create=UserCreate(
            email=random_email(),
            password=random_lower_string(),
        ),
    )


class TestPersistenceTools:
    def test_save_draft_post(self, db: Session) -> None:
        user = _make_user(db=db)
        post = save_draft_post(
            user_id=str(user.id),
            content="Testing autonomous tools persistence pipeline",
            platform="x",
            session=db,
        )
        assert post is not None
        assert post.id is not None
        assert post.status == "draft"
        assert post.owner_id == user.id

    def test_schedule_post_in_db(self, db: Session) -> None:
        user = _make_user(db=db)
        post = schedule_post_in_db(
            user_id=str(user.id),
            content="Scheduled post content",
            scheduled_at_iso="2026-12-31T12:00:00Z",
            session=db,
        )
        assert post is not None
        assert post.status == "scheduled"
        assert post.scheduled_at is not None

    @pytest.mark.anyio
    async def test_publish_post_live(self, db: Session) -> None:
        user = _make_user(db=db)
        post = save_draft_post(
            user_id=str(user.id),
            content="Live post test",
            platform="x",
            session=db,
        )
        assert post is not None
        with patch(
            "app.services.agentic.tools.persistence_tools.publish_post",
            new_callable=AsyncMock,
        ) as mock_pub:
            mock_pub.return_value = "123456789"
            report = await publish_post_live(
                post_id=str(post.id),
                user_id=str(user.id),
                session=db,
            )
            assert report.success is True
            mock_pub.assert_awaited_once()

    def test_update_post_in_db(self, db: Session) -> None:
        user = _make_user(db=db)
        post = save_draft_post(
            user_id=str(user.id),
            content="Original content",
            platform="x",
            session=db,
        )
        assert post is not None
        updated = update_post_in_db(
            post_id=str(post.id),
            user_id=str(user.id),
            content="Updated content take 2",
            session=db,
        )
        assert updated is not None
        assert updated.content == "Updated content take 2"

    def test_delete_post_from_db(self, db: Session) -> None:
        user = _make_user(db=db)
        post = save_draft_post(
            user_id=str(user.id),
            content="To be deleted",
            platform="x",
            session=db,
        )
        assert post is not None
        deleted = delete_post_from_db(
            post_id=str(post.id),
            user_id=str(user.id),
            session=db,
        )
        assert deleted is True


class TestVerificationTools:
    def test_fuzzy_text_match(self) -> None:
        expected = "FastAPI 0.115 released with amazing features! Check it out at https://fastapi.tiangolo.com"
        actual = "FastAPI 0.115 released with amazing features Check it out at"
        match, score = _fuzzy_text_match(expected=expected, actual=actual)
        assert match is True
        assert score > 0.8

    def test_token_overlap(self) -> None:
        match, ratio = _calculate_token_overlap(
            "hello world new test", "hello world new extra"
        )
        assert match is True
        assert ratio >= 0.7

    @pytest.mark.anyio
    async def test_verify_post_on_live_profile(self) -> None:
        with (
            patch(
                "app.services.agentic.tools.verification_tools.BrowserManager"
            ) as mock_bm_cls,
            patch(
                "app.services.agentic.tools.verification_tools._get_expected_post_data"
            ) as mock_res,
        ):
            mock_res.return_value = ("Test content", "12345")
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = False
            mock_bm_cls.return_value = mock_bm

            report = await verify_post_on_live_profile(
                user_id="3fa85f64-5717-4562-b3fc-2c963f66afa6",
                expected_post_id="3fa85f64-5717-4562-b3fc-2c963f66afa7",
            )
            assert report.verified_live is False
            assert "No active X.com browser session" in (report.error or "")

    @pytest.mark.anyio
    async def test_verify_post_url_status(self) -> None:
        mock_page = AsyncMock()
        mock_context = AsyncMock()
        mock_context.pages = [mock_page]

        with patch(
            "app.services.agentic.tools.verification_tools.BrowserManager"
        ) as mock_bm_cls:
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = True
            mock_bm.get_context.return_value.__aenter__.return_value = mock_context
            mock_bm_cls.return_value = mock_bm

            mock_page.goto.return_value = MagicMock(status=200)
            mock_page.inner_text = AsyncMock(return_value="Active post text")

            report = await verify_post_url_status(
                user_id="3fa85f64-5717-4562-b3fc-2c963f66afa6",
                post_url="https://x.com/user/status/123456",
            )
            assert report.is_live is True
            assert report.post_url == "https://x.com/user/status/123456"
