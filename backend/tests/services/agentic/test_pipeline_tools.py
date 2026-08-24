"""Comprehensive test suite for LinkX Lean Agentic Tools."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
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
from app.services.agentic.tools.curation_tools import (
    draft_social_post,
    refine_post_draft,
    validate_post_constraints,
)
from app.services.agentic.tools.diagnostics_tools import (
    inspect_dom_snippet,
    probe_and_patch_broken_selector,
)
from app.services.agentic.tools.persistence_tools import (
    delete_post_from_db,
    publish_post_live,
    save_draft_post,
    schedule_post_in_db,
    update_post_in_db,
)
from app.services.agentic.tools.verification_tools import (
    _fuzzy_text_match,
    verify_post_on_live_profile,
    verify_post_url_status,
)
from tests.utils.utils import random_email, random_lower_string


def _make_user(db: Session) -> User:
    return crud.create_user(
        session=db,
        user_create=UserCreate(
            email=random_email(),
            password=random_lower_string(),
        ),
    )


class TestContextTools:
    def test_get_latest_scraped_trends(self, db: Session) -> None:
        user = _make_user(db)
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
        user = _make_user(db)
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
        user = _make_user(db)
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
        user = _make_user(db)

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
        user = _make_user(db)

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


class TestCurationTools:
    @pytest.mark.anyio
    async def test_draft_social_post(self) -> None:
        with patch(
            "app.services.agentic.tools.curation_tools.generate_ai_post_draft",
            return_value="Autonomous agents are changing the software landscape. #AI",
        ) as mock_draft:
            res = await draft_social_post(
                topic_title="AI Agents in Production",
                topic_summary="Frameworks for self-healing automation",
                platform="x",
            )
            assert "Autonomous agents" in res
            mock_draft.assert_called_once()

    def test_validate_post_constraints_compliant(self) -> None:
        report = validate_post_constraints(
            content="Building in public with clean architecture and self-healing tools! #BuildInPublic",
            platform="x",
            is_premium=False,
        )
        assert report.is_compliant is True
        assert report.char_count > 0
        assert report.max_limit == 280

    def test_validate_post_constraints_exceeded(self) -> None:
        giant_content = "Word " * 100  # 500 chars > 280
        report = validate_post_constraints(
            content=giant_content,
            platform="x",
            is_premium=False,
        )
        assert report.is_compliant is False
        assert len(report.violations) >= 1
        assert "exceeds" in report.violations[0]

    @pytest.mark.anyio
    async def test_refine_post_draft(self) -> None:
        with patch(
            "app.services.agentic.tools.curation_tools.generate_ai_post_draft",
            return_value="Short punchy take. #Tech",
        ):
            res = await refine_post_draft(
                content="Long wordy draft that needs trimming",
                platform="x",
                instructions="Shorten to under 30 chars",
            )
            assert res == "Short punchy take. #Tech"


class TestPersistenceTools:
    def test_save_draft_post(self, db: Session) -> None:
        user = _make_user(db)

        draft = save_draft_post(
            user_id=str(user.id),
            content="Agent draft to be reviewed.",
            platform="x",
            session=db,
        )
        assert draft is not None
        assert draft.status == "draft"
        assert draft.method == "agent"

    def test_schedule_post_in_db(self, db: Session) -> None:
        user = _make_user(db)

        target_time = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
        sched_post = schedule_post_in_db(
            user_id=str(user.id),
            content="Scheduled agent post.",
            platform="x",
            scheduled_at_iso=target_time,
            session=db,
        )
        assert sched_post is not None
        assert sched_post.status == "scheduled"

    def test_update_and_delete_post_in_db(self, db: Session) -> None:
        user = _make_user(db)
        p = Post(
            owner_id=user.id, content="Original text", platform="x", status="draft"
        )
        db.add(p)
        db.commit()
        db.refresh(p)
        post_id = str(p.id)

        updated = update_post_in_db(
            post_id=post_id,
            user_id=str(user.id),
            content="Updated by agent",
            session=db,
        )
        assert updated is not None
        assert updated.content == "Updated by agent"

        deleted = delete_post_from_db(post_id=post_id, user_id=str(user.id), session=db)
        assert deleted is True

    @pytest.mark.anyio
    async def test_publish_post_live_success(self, db: Session) -> None:
        user = _make_user(db)
        p = Post(
            owner_id=user.id, content="Ready to publish", platform="x", status="draft"
        )
        db.add(p)
        db.commit()
        db.refresh(p)
        post_id = str(p.id)

        with patch(
            "app.services.agentic.tools.persistence_tools.publish_post",
            return_value="x:182938192",
        ):
            res = await publish_post_live(
                post_id=post_id, user_id=str(user.id), session=db
            )
            assert res.success is True
            assert res.post_id == post_id


class TestVerificationTools:
    def test_fuzzy_text_match(self) -> None:
        # Exact match
        ok, conf = _fuzzy_text_match("Hello world from LinkX", "Hello world from LinkX")
        assert ok is True
        assert conf >= 0.95

        # Substring prefix match
        ok, conf = _fuzzy_text_match(
            "Announcing our new open-source agentic tools for social media!",
            "Announcing our new open-source agentic tools for social media! Link: https://t.co/xyz",
        )
        assert ok is True
        assert conf >= 0.9

        # Total mismatch
        ok, conf = _fuzzy_text_match(
            "Crypto market crashes today", "Recipe for chocolate cake"
        )
        assert ok is False
        assert conf < 0.3

    @pytest.mark.anyio
    async def test_verify_post_on_live_profile_matching(self, db: Session) -> None:
        user = _make_user(db)
        p = Post(
            owner_id=user.id,
            content="Building the future of agentic coding and browser automation!",
            platform="x",
            status="published",
            external_post_id="99887766",
        )
        db.add(p)
        db.commit()

        mock_page = AsyncMock()
        mock_context = AsyncMock()
        mock_context.pages = [mock_page]

        with (
            patch(
                "app.services.agentic.tools.verification_tools.BrowserManager"
            ) as mock_bm_cls,
            patch(
                "app.services.agentic.tools.verification_tools._extract_profile_timeline_tweets",
                return_value=[
                    {
                        "text": "Building the future of agentic coding and browser automation! #AI",
                        "status_id": "99887766",
                        "status_url": "https://x.com/user/status/99887766",
                    }
                ],
            ),
        ):
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = True
            mock_bm.read_session_metadata.return_value = {"username": "live_user"}
            mock_bm.get_context.return_value.__aenter__.return_value = mock_context
            mock_bm_cls.return_value = mock_bm

            report = await verify_post_on_live_profile(user_id=str(user.id), session=db)
            assert report.verified_live is True
            assert report.match_found is True
            assert report.matched_tweet_id == "99887766"
            assert report.match_confidence >= 0.9

    @pytest.mark.anyio
    async def test_verify_post_url_status(self, db: Session) -> None:
        user = _make_user(db)
        mock_page = AsyncMock()
        mock_page.inner_text.return_value = "Normal tweet content on active page"
        mock_context = AsyncMock()
        mock_context.pages = [mock_page]

        with patch(
            "app.services.agentic.tools.verification_tools.BrowserManager"
        ) as mock_bm_cls:
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = True
            mock_bm.get_context.return_value.__aenter__.return_value = mock_context
            mock_bm_cls.return_value = mock_bm

            mock_resp = MagicMock()
            mock_resp.status = 200
            mock_page.goto.return_value = mock_resp

            status_report = await verify_post_url_status(
                post_url="https://x.com/user/status/12345",
                user_id=str(user.id),
            )
            assert status_report.is_live is True
            assert status_report.status_code == 200


class TestDiagnosticsTools:
    @pytest.mark.anyio
    async def test_inspect_dom_snippet(self, db: Session) -> None:
        user = _make_user(db)
        mock_page = AsyncMock()
        mock_page.url = "https://x.com/home"
        mock_context = AsyncMock()
        mock_context.pages = [mock_page]

        with (
            patch(
                "app.services.agentic.tools.diagnostics_tools.BrowserManager"
            ) as mock_bm_cls,
            patch(
                "app.services.agentic.tools.diagnostics_tools.get_dom_snippet",
                return_value="<div data-testid='tweetText'>Hello</div>",
            ),
            patch(
                "app.services.agentic.tools.diagnostics_tools.detect_page_state",
                return_value="ok",
            ),
        ):
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = True
            mock_bm.get_context.return_value.__aenter__.return_value = mock_context
            mock_bm_cls.return_value = mock_bm

            res = await inspect_dom_snippet(user_id=str(user.id))
            assert res["success"] is True
            assert res["page_state"] == "ok"
            assert "<div data-testid='tweetText'>" in res["dom_snippet"]

    @pytest.mark.anyio
    async def test_test_and_patch_broken_selector(self, db: Session, tmp_path) -> None:
        user = _make_user(db)
        mock_page = AsyncMock()
        mock_context = AsyncMock()
        mock_context.pages = [mock_page]

        cfg_file = tmp_path / "selectors.json"
        cfg_file.write_text('{"compose": {"post_input": "old_sel"}}')

        with (
            patch(
                "app.services.agentic.tools.diagnostics_tools.BrowserManager"
            ) as mock_bm_cls,
            patch(
                "app.services.agentic.tools.diagnostics_tools.validate_selector_candidate",
                return_value={"found": True, "visible": True, "count": 1},
            ),
        ):
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = True
            mock_bm.get_context.return_value.__aenter__.return_value = mock_context
            mock_bm_cls.return_value = mock_bm

            res = await probe_and_patch_broken_selector(
                user_id=str(user.id),
                selector_key="compose.post_input",
                candidate_selector="div[data-testid='tweetTextarea_0']",
                config_path=str(cfg_file),
            )
            assert res["success"] is True
            assert res["patched"] is True
            assert res["new_selector"] == "div[data-testid='tweetTextarea_0']"
