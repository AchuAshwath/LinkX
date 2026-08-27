"""Unit and integration tests for ScrapingGraph Orchestrator (Issue #92)."""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langgraph.graph import END

from app.models import TrendingTopic, TrendingTweet
from app.services.agentic.schemas import ScrapedBatchReport, SessionRecoveryReport
from app.services.agentic.scraping_graph import (
    _load_selectors,
    _route_after_session_check,
    build_scraping_graph,
    init_and_recover_session_node,
    persist_scraped_batch_node,
    scrape_explore_trends_node,
    scrape_trends_with_graph,
)


class MockPage:
    """Mock Playwright Page for ScrapingGraph testing."""

    def __init__(
        self,
        *,
        url: str = "https://x.com/home",
        title: str = "Home / X",
        page_state: str = "ok",
        overlay: str | None = None,
    ) -> None:
        self.url = url
        self._title = title
        self.page_state = page_state
        self.overlay = overlay
        self.goto_calls: list[str] = []
        self.keyboard = AsyncMock()

    async def title(self) -> str:
        return self._title

    async def goto(self, url: str, *args: Any, **kwargs: Any) -> None:
        self.goto_calls.append(url)
        self.url = url

    def locator(self, selector: str) -> Any:
        loc = AsyncMock()
        loc.count = AsyncMock(return_value=1 if self.overlay else 0)
        loc.is_visible = AsyncMock(return_value=bool(self.overlay))
        loc.first = loc
        loc.click = AsyncMock()
        return loc


class MockContext:
    def __init__(self, page: MockPage) -> None:
        self.page = page

    async def __aenter__(self) -> MockContext:
        return self

    async def __aexit__(self, *args: Any) -> None:
        pass


def _make_default_topics() -> list[TrendingTopic]:
    return [
        TrendingTopic(
            id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            topic_url=f"https://x.com/i/topics/{i}",
            topic_title=f"Trending Topic {i}",
            post_count=1000 * i,
            category="Technology",
        )
        for i in range(1, 4)
    ]


def _make_default_tweets() -> list[TrendingTweet]:
    return [
        TrendingTweet(
            topic_id=uuid.uuid4(),
            author_handle="@sama",
            text="Autonomous agents will revolutionize social pipelines.",
            likes=100,
            views=1000,
        )
    ]


@contextmanager
def _patch_browser_layer(**kwargs: Any):
    mock_mgr = kwargs.get("mock_mgr")
    mock_page = kwargs.get("mock_page")
    page_state = kwargs.get("page_state", "ok")
    nav_ok = kwargs.get("nav_ok", True)
    with (
        patch(
            "app.services.agentic.scraping_graph.BrowserManager", return_value=mock_mgr
        ) as p_mgr,
        patch(
            "app.services.agentic.scraping_graph.get_active_page",
            new_callable=AsyncMock,
            return_value=mock_page,
        ) as p_page,
        patch(
            "app.services.agentic.scraping_graph.detect_page_state",
            new_callable=AsyncMock,
            return_value=page_state,
        ) as p_state,
        patch(
            "app.services.agentic.scraping_graph.navigate_to_trends",
            new_callable=AsyncMock,
            return_value=nav_ok,
        ) as p_nav,
    ):
        yield {
            "manager": p_mgr,
            "page": p_page,
            "detect_state": p_state,
            "nav_trends": p_nav,
        }


@contextmanager
def _patch_scraping_extractors(**kwargs: Any):
    mock_topics = kwargs.get("mock_topics")
    grok_summary = kwargs.get("grok_summary")
    mock_tweets = kwargs.get("mock_tweets")
    recovery_report = kwargs.get("recovery_report")
    detect_overlay_return = kwargs.get("detect_overlay_return")

    with (
        patch(
            "app.services.agentic.scraping_graph.extract_trending_sidebar",
            new_callable=AsyncMock,
            return_value=mock_topics,
        ) as p_side,
        patch(
            "app.services.agentic.scraping_graph.extract_grok_summary",
            new_callable=AsyncMock,
            return_value=grok_summary,
        ) as p_grok,
        patch(
            "app.services.agentic.scraping_graph.extract_topic_tweets",
            new_callable=AsyncMock,
            return_value=mock_tweets,
        ) as p_tweets,
        patch(
            "app.services.agentic.scraping_graph.recover_page_session",
            new_callable=AsyncMock,
            return_value=recovery_report,
        ) as p_rec,
        patch(
            "app.services.agentic.scraping_graph._detect_overlay",
            new_callable=AsyncMock,
            return_value=detect_overlay_return,
        ) as p_over,
        patch(
            "app.services.agentic.scraping_persistence.crud.upsert_trending_topic",
            return_value=mock_topics[0] if mock_topics else None,
        ) as p_upsert,
        patch(
            "app.services.agentic.scraping_persistence.crud.replace_trending_tweets",
            return_value=None,
        ) as p_replace,
    ):
        yield {
            "sidebar": p_side,
            "grok": p_grok,
            "tweets": p_tweets,
            "recovery": p_rec,
            "overlay": p_over,
            "upsert": p_upsert,
            "replace": p_replace,
        }


@contextmanager
def patch_scraping_pipeline(**kwargs: Any):
    """Unified mock context manager for ScrapingGraph testing."""
    page_state = kwargs.get("page_state", "ok")
    mock_page = kwargs.get("page") or MockPage(page_state=page_state)
    mock_mgr = MagicMock()
    mock_mgr.session_exists.return_value = kwargs.get("session_exists", True)
    mock_mgr.get_context.return_value = MockContext(mock_page)

    mock_topics = (
        kwargs.get("sidebar_topics")
        if kwargs.get("sidebar_topics") is not None
        else _make_default_topics()
    )
    mock_tweets = (
        kwargs.get("tweets_return")
        if kwargs.get("tweets_return") is not None
        else _make_default_tweets()
    )
    grok_summary = kwargs.get("grok_summary", "AI Revolution is trending.")
    recovery_report = kwargs.get("recovery_report") or SessionRecoveryReport(
        recovered=True
    )
    detect_overlay_return = kwargs.get("detect_overlay_return")
    nav_trends_return = kwargs.get("nav_trends_return", True)

    with (
        _patch_browser_layer(
            mock_mgr=mock_mgr,
            mock_page=mock_page,
            page_state=page_state,
            nav_ok=nav_trends_return,
        ) as b_patches,
        _patch_scraping_extractors(
            mock_topics=mock_topics,
            grok_summary=grok_summary,
            mock_tweets=mock_tweets,
            recovery_report=recovery_report,
            detect_overlay_return=detect_overlay_return,
        ) as e_patches,
    ):
        yield {**b_patches, **e_patches}


class TestScrapingGraphSlices:
    """Test suite covering all vertical slices for ScrapingGraph."""

    @pytest.mark.anyio
    async def test_slice_1_happy_path_scraping_and_persistence(self) -> None:
        with patch_scraping_pipeline() as p:
            report = await scrape_trends_with_graph(
                user_id="11111111-1111-1111-1111-111111111111",
                max_topics=3,
                headless=True,
            )
            assert isinstance(report, ScrapedBatchReport)
            assert report.status == "persisted"
            assert report.persisted_topic_count == 3
            assert report.persisted_tweet_count == 3
            assert len(report.scraped_topics) == 3
            p["upsert"].assert_called()
            p["replace"].assert_called()

    @pytest.mark.anyio
    async def test_slice_2_no_stored_session_immediate_abort(self) -> None:
        with patch_scraping_pipeline(session_exists=False):
            report = await scrape_trends_with_graph(
                user_id="11111111-1111-1111-1111-111111111111"
            )
            assert report.status == "unrecoverable"
            assert report.page_state == "logged_out"
            assert report.persisted_topic_count == 0

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "redirect_url", ["https://x.com/login", "https://x.com/i/flow/login"]
    )
    async def test_slice_3_auth_redirect_abort(self, redirect_url: str) -> None:
        page = MockPage(url=redirect_url, page_state="logged_out")
        with patch_scraping_pipeline(page=page, page_state="logged_out"):
            report = await scrape_trends_with_graph(
                user_id="11111111-1111-1111-1111-111111111111"
            )
            assert report.status == "unrecoverable"
            assert report.page_state == "logged_out"

    @pytest.mark.anyio
    async def test_slice_4_captcha_challenge_abort(self) -> None:
        page = MockPage(title="Attention Required! | Cloudflare", page_state="captcha")
        with patch_scraping_pipeline(page=page, page_state="captcha"):
            report = await scrape_trends_with_graph(
                user_id="11111111-1111-1111-1111-111111111111"
            )
            assert report.status == "unrecoverable"
            assert report.page_state == "captcha"

    @pytest.mark.anyio
    async def test_slice_5_modal_overlay_auto_recovery(self) -> None:
        rec_report = SessionRecoveryReport(
            recovered=True,
            overlay_type="notification_prompt",
            recovery_action="click_not_now",
            status="recovered",
            page_state="ok",
        )
        with patch_scraping_pipeline(
            page_state="rate_limited",
            detect_overlay_return="notification_prompt",
            recovery_report=rec_report,
        ):
            report = await scrape_trends_with_graph(
                user_id="11111111-1111-1111-1111-111111111111"
            )
            assert report.status == "persisted"
            assert report.session_recovery is not None
            assert report.session_recovery.get("recovered") is True

    @pytest.mark.anyio
    async def test_slice_6_session_recovery_fails(self) -> None:
        rec_report = SessionRecoveryReport(
            recovered=False, status="unrecovered", page_state="rate_limited"
        )
        with patch_scraping_pipeline(
            page_state="rate_limited", recovery_report=rec_report
        ):
            report = await scrape_trends_with_graph(
                user_id="11111111-1111-1111-1111-111111111111"
            )
            assert report.status == "unrecoverable"
            assert report.session_recovery.get("recovered") is False

    @pytest.mark.anyio
    async def test_slice_7_partial_batch_resilience(self) -> None:
        with patch_scraping_pipeline() as p:
            p["tweets"].side_effect = [
                [
                    TrendingTweet(
                        topic_id=uuid.uuid4(), text="tweet 1", author_handle="@u1"
                    )
                ],
                Exception("Nav Timeout"),
                [
                    TrendingTweet(
                        topic_id=uuid.uuid4(), text="tweet 3", author_handle="@u3"
                    )
                ],
            ]
            report = await scrape_trends_with_graph(
                user_id="11111111-1111-1111-1111-111111111111", max_topics=3
            )
            assert report.persisted_topic_count == 3
            assert len(report.failed_topics) == 1
            assert "Nav Timeout" in report.failed_topics[0]["reason"]

    @pytest.mark.anyio
    async def test_slice_8_empty_explore_page(self) -> None:
        with patch_scraping_pipeline(sidebar_topics=[]):
            report = await scrape_trends_with_graph(
                user_id="11111111-1111-1111-1111-111111111111"
            )
            assert report.scraped_topics == []
            assert report.persisted_topic_count == 0

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("input_max", "expected_clamped"),
        [(0, 1), (-5, 1), (100, 10), (3, 3)],
    )
    async def test_slice_9_max_topics_boundary_clamping(
        self, input_max: int, expected_clamped: int
    ) -> None:
        with patch_scraping_pipeline():
            report = await scrape_trends_with_graph(
                user_id="11111111-1111-1111-1111-111111111111", max_topics=input_max
            )
            assert len(report.topic_tweets_map) <= expected_clamped

    @pytest.mark.anyio
    async def test_slice_10_browser_launch_crash_shielding(self) -> None:
        with patch("app.services.agentic.scraping_graph.BrowserManager") as p_mgr:
            p_mgr.return_value.session_exists.return_value = True
            p_mgr.return_value.get_context.side_effect = Exception(
                "Chrome binary missing"
            )
            report = await scrape_trends_with_graph(
                user_id="11111111-1111-1111-1111-111111111111"
            )
            assert report.status == "error"
            assert "Chrome binary missing" in (report.error or "")

    @pytest.mark.anyio
    async def test_slice_11_graph_compilation_and_schema_validation(self) -> None:
        graph = build_scraping_graph()
        assert graph is not None
        report = ScrapedBatchReport(
            scraped_topics=[], persisted_topic_count=5, status="persisted"
        )
        assert ScrapedBatchReport.model_validate(report.model_dump()) == report


class TestScrapingGraphNodeUnits:
    """Targeted unit tests for node handlers, selector loading, and user resolution."""

    @pytest.mark.anyio
    async def test_init_and_recover_session_node_missing_page(self) -> None:
        out = await init_and_recover_session_node({"user_id": "user-123"})
        assert out["status"] == "unrecoverable"
        assert out["page_state"] in ("logged_out", "error")

    @pytest.mark.anyio
    async def test_scrape_explore_trends_node_missing_page(self) -> None:
        out = await scrape_explore_trends_node({})
        assert out["status"] == "error"
        assert out["scraped_topics"] == []

    @pytest.mark.anyio
    async def test_scrape_explore_trends_node_navigation_failure(self) -> None:
        page = MockPage(page_state="error")
        with (
            patch(
                "app.services.agentic.scraping_graph.navigate_to_trends",
                return_value=False,
            ),
            patch(
                "app.services.agentic.scraping_graph.detect_page_state",
                return_value="error",
            ),
        ):
            out = await scrape_explore_trends_node({"page": page})
            assert out["status"] == "error"
            assert out["scraped_topics"] == []

    @pytest.mark.anyio
    async def test_persist_scraped_batch_node_empty_topics(self) -> None:
        out = await persist_scraped_batch_node({"scraped_topics": []})
        assert out["persisted_topic_count"] == 0
        assert out["status"] == "persisted"

    @pytest.mark.anyio
    async def test_persist_scraped_batch_node_db_error(self) -> None:
        with patch(
            "app.services.agentic.scraping_persistence.resolve_session",
            side_effect=Exception("DB Connection Refused"),
        ):
            out = await persist_scraped_batch_node(
                {"scraped_topics": [{"title": "T1", "url": "https://x.com/1"}]}
            )
            assert out["status"] == "error"

    def test_route_after_session_check(self) -> None:
        assert _route_after_session_check({"page_state": "logged_out"}) == END
        assert _route_after_session_check({"page_state": "captcha"}) == END
        assert _route_after_session_check({"status": "unrecoverable"}) == END
        assert (
            _route_after_session_check({"page_state": "ok", "status": "session_ready"})
            == "scrape_explore_trends"
        )

    def test_resolve_user_id_fallback(self) -> None:
        from app.services.agentic.scraping_persistence import _resolve_user_id

        mock_session = MagicMock()
        mock_session.exec.return_value.first.return_value = None
        resolved = _resolve_user_id(
            user_id="invalid-non-uuid-string", session=mock_session
        )
        assert isinstance(resolved, uuid.UUID)

    def test_load_selectors(self) -> None:
        selectors = _load_selectors()
        assert isinstance(selectors, dict)
        assert "selectors" in selectors or "feed" in selectors
