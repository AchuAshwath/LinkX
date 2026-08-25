"""Comprehensive test suite for LinkX Lean Agentic Tools."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlmodel import Session

from app import crud
from app.models import Post, TrendingTopic, TrendingTweet, User, UserCreate
from app.services.agentic.tools.context_tools import (
    get_latest_published_post,
    get_latest_scraped_trends,
    get_recent_post_history,
    get_social_account_status,
    get_topic_tweets_and_summary,
)
from app.services.agentic.tools.perception_tools import (
    inspect_page_session_state,
    scrape_live_explore_trends,
    scrape_topic_timeline,
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


class TestContextTools:
    def test_get_latest_scraped_trends(self, db: Session) -> None:
        user = _make_user(db=db)
        now = datetime.now(timezone.utc)

        topic = TrendingTopic(
            user_id=user.id,
            topic_title="AI Architecture 2026",
            category="Technology",
            post_count=12000,
            topic_url="https://x.com/search?q=AI_Architecture",
            scraped_at=now,
        )
        db.add(topic)
        db.commit()

        trends = get_latest_scraped_trends(user_id=str(user.id), limit=5, session=db)
        assert len(trends) >= 1
        assert any(t.topic_title == "AI Architecture 2026" for t in trends)

    def test_get_topic_tweets_and_summary(self, db: Session) -> None:
        user = _make_user(db=db)
        now = datetime.now(timezone.utc)

        topic = TrendingTopic(
            user_id=user.id,
            topic_title="Quantum Computing Leap",
            summary="Major milestone in error correction",
            topic_url="https://x.com/search?q=Quantum",
            scraped_at=now,
        )
        db.add(topic)
        db.commit()
        db.refresh(topic)

        tweet = TrendingTweet(
            topic_id=topic.id,
            author_handle="@quantum_lab",
            text="We achieved 99.9% logical qubit fidelity today!",
            likes=540,
            retweets=120,
        )
        db.add(tweet)
        db.commit()

        details = get_topic_tweets_and_summary(
            topic_id=str(topic.id), max_tweets=5, session=db
        )
        assert details is not None
        assert details.topic_title == "Quantum Computing Leap"
        assert details.summary == "Major milestone in error correction"
        assert len(details.sample_tweets) == 1
        assert details.sample_tweets[0]["author"] == "@quantum_lab"

    def test_get_latest_published_post(self, db: Session) -> None:
        user = _make_user(db=db)
        now = datetime.now(timezone.utc)

        post = Post(
            owner_id=user.id,
            content="Announcing our new open-source agentic tools!",
            platform="x",
            status="published",
            published_at=now,
            external_post_id="18928392819",
        )
        db.add(post)
        db.commit()

        pub_post = get_latest_published_post(
            user_id=str(user.id), platform="x", session=db
        )
        assert pub_post is not None
        assert pub_post.content == "Announcing our new open-source agentic tools!"
        assert pub_post.status == "published"

    def test_get_recent_post_history(self, db: Session) -> None:
        user = _make_user(db=db)

        p1 = Post(owner_id=user.id, content="Draft 1", platform="x", status="draft")
        p2 = Post(
            owner_id=user.id, content="Draft 2", platform="linkedin", status="draft"
        )
        db.add(p1)
        db.add(p2)
        db.commit()

        history = get_recent_post_history(user_id=str(user.id), limit=10, session=db)
        assert len(history) >= 2

    def test_get_social_account_status(self, db: Session) -> None:
        user = _make_user(db=db)

        with patch(
            "app.services.agentic.tools.context_tools.BrowserManager"
        ) as mock_bm_cls:
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = True
            mock_bm.read_session_metadata.return_value = {
                "username": "agent_master",
                "is_premium": True,
                "max_character_limit": 25000,
            }
            mock_bm_cls.return_value = mock_bm

            report = get_social_account_status(user_id=str(user.id), session=db)
            assert report.x_connected is True
            assert report.x_username == "agent_master"
            assert report.x_is_premium is True
            assert report.x_max_characters == 25000


class TestPerceptionTools:
    @pytest.mark.anyio
    async def test_scrape_live_explore_trends_success(self) -> None:
        mock_result = MagicMock()
        mock_result.status = "success"
        mock_result.topics_found = 5
        mock_result.topics_scraped = 3
        mock_result.errors = []

        with patch(
            "app.services.agentic.tools.perception_tools.scrape_trending_topics",
            return_value=mock_result,
        ):
            res = await scrape_live_explore_trends(user_id="user-123", max_topics=3)
            assert res["status"] == "success"
            assert res["topics_scraped"] == 3
            assert res["errors"] == []

    @pytest.mark.anyio
    async def test_scrape_live_explore_trends_exception_handling(self) -> None:
        with patch(
            "app.services.agentic.tools.perception_tools.scrape_trending_topics",
            side_effect=RuntimeError("Browser crashed"),
        ):
            res = await scrape_live_explore_trends(user_id="user-123", max_topics=3)
            assert res["status"] == "error"
            assert "Browser crashed" in res["errors"][0]

    @pytest.mark.anyio
    async def test_scrape_topic_timeline_success(self) -> None:
        mock_page = AsyncMock()
        mock_context = AsyncMock()
        mock_context.pages = [mock_page]

        mock_tweet = MagicMock()
        mock_tweet.author_handle = "@engineer"
        mock_tweet.text = "Exploring new AI architectures"
        mock_tweet.likes = 42
        mock_tweet.retweets = 10
        mock_tweet.replies = 2
        mock_tweet.views = 1000

        with (
            patch(
                "app.services.agentic.tools.perception_tools.BrowserManager"
            ) as mock_bm_cls,
            patch(
                "app.services.agentic.tools.perception_tools.extract_grok_summary",
                return_value="Grok summary of tech trend",
            ),
            patch(
                "app.services.agentic.tools.perception_tools.extract_topic_tweets",
                return_value=[mock_tweet],
            ),
        ):
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = True
            mock_bm.get_context.return_value.__aenter__.return_value = mock_context
            mock_bm_cls.return_value = mock_bm

            res = await scrape_topic_timeline(
                topic_url="https://x.com/search?q=AI",
                user_id="user-123",
                max_tweets=5,
            )
            assert res["success"] is True
            assert res["grok_summary"] == "Grok summary of tech trend"
            assert len(res["tweets"]) == 1
            assert res["tweets"][0]["author"] == "@engineer"

    @pytest.mark.anyio
    async def test_scrape_topic_timeline_no_session(self) -> None:
        with patch(
            "app.services.agentic.tools.perception_tools.BrowserManager"
        ) as mock_bm_cls:
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = False
            mock_bm_cls.return_value = mock_bm

            res = await scrape_topic_timeline(
                topic_url="https://x.com/search?q=AI",
                user_id="user-123",
            )
            assert res["success"] is False
            assert "X session not connected" in res["error"]

    @pytest.mark.anyio
    async def test_inspect_page_session_state(self) -> None:
        with patch(
            "app.services.agentic.tools.perception_tools.BrowserManager"
        ) as mock_bm_cls:
            mock_bm = MagicMock()
            mock_bm.verify_session = AsyncMock(
                return_value={
                    "connected": True,
                    "authenticated": True,
                    "page_state": "ok",
                }
            )
            mock_bm_cls.return_value = mock_bm

            res = await inspect_page_session_state(user_id="user-123", platform="x")
            assert res["connected"] is True
            assert res["page_state"] == "ok"

    @pytest.mark.anyio
    async def test_inspect_page_session_state_error_handling(self) -> None:
        with patch(
            "app.services.agentic.tools.perception_tools.BrowserManager"
        ) as mock_bm_cls:
            mock_bm = MagicMock()
            mock_bm.verify_session = AsyncMock(
                side_effect=RuntimeError("Browser launch failure")
            )
            mock_bm_cls.return_value = mock_bm

            res = await inspect_page_session_state(user_id="user-123", platform="x")
            assert res["connected"] is False
            assert res["page_state"] == "error"
            assert "Browser launch failure" in res["error"]
