"""Exhaustive chaos and adversarial attack suite for ScrapingGraph Orchestrator (Issue #92).

Attacks & Stress Scenarios:
1. Adversarial & Boundary Inputs (max_topics boundaries, SQL injection user_id, invalid UUIDs).
2. Browser & Network Disasters (TargetClosedError crash injections at every node, alien/malformed page objects).
3. Sentinel State & Session Recovery Storms (rapid state oscillation, timeout in recovery, unrecoverable states).
4. DOM Extraction & Data Corruption (malformed topics, invalid URLs, corrupted metrics, null bytes).
5. Database Transaction Collisions (IntegrityError, rollback recovery, partial batch resilience, string limits).
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.agentic.schemas import ScrapedBatchReport, SessionRecoveryReport
from app.services.agentic.scraping_graph import (
    ScrapingGraphState,
    _parse_clamped_max_topics,
    _resolve_user_id,
    _safe_int,
    extract_topic_timelines_node,
    init_and_recover_session_node,
    persist_scraped_batch_node,
    scrape_explore_trends_node,
    scrape_trends_with_graph,
)


class TargetClosedError(Exception):
    """Simulates Playwright TargetClosedError when the browser process crashes."""


class BrokenChaosPage:
    """Mock page that can inject failures across various Playwright APIs."""

    def __init__(
        self,
        *,
        url: str = "https://x.com/home",
        fail_goto: bool = False,
        fail_title: bool = False,
        fail_locator: bool = False,
    ) -> None:
        self.url = url
        self.fail_goto = fail_goto
        self.fail_title = fail_title
        self.fail_locator = fail_locator
        self.keyboard = AsyncMock()

    async def title(self) -> str:
        if self.fail_title:
            raise TargetClosedError("Page crashed while fetching title")
        return "Home / X"

    async def goto(self, url: str, *args: Any, **kwargs: Any) -> None:
        if self.fail_goto:
            raise TargetClosedError(f"Target closed navigating to {url}")
        self.url = url

    def locator(self, selector: str) -> Any:
        if self.fail_locator:
            raise TargetClosedError(f"Target closed querying selector {selector}")
        loc = AsyncMock()
        loc.count = AsyncMock(return_value=0)
        loc.is_visible = AsyncMock(return_value=False)
        loc.first = loc
        loc.click = AsyncMock()
        return loc


class MockContextManager:
    """Async context manager wrapper for mock browser context."""

    def __init__(self, page: Any) -> None:
        self.context = MagicMock()
        self.context.pages = [page]

    async def __aenter__(self) -> Any:
        return self.context

    async def __aexit__(self, *args: Any) -> None:
        pass


# ==============================================================================
# 1. ADVERSARIAL & BOUNDARY INPUT ATTACKS
# ==============================================================================


class TestAdversarialBoundaryInputs:
    """Attacks targeting input validation, clamping, and type coercion."""

    @pytest.mark.parametrize(
        ("raw_input", "expected"),
        [
            (-10, 1),
            (0, 1),
            (10000, 10),
            ("5", 5),
            (None, 3),
            ("invalid_text", 3),
            ([], 3),
            ({}, 3),
            (3.9, 3),
        ],
    )
    def test_max_topics_boundary_clamping(self, raw_input: Any, expected: int) -> None:
        """max_topics safely handles negative, huge, string, and malformed inputs."""
        assert _parse_clamped_max_topics(raw_input) == expected

    @pytest.mark.parametrize(
        ("metric_input", "expected"),
        [
            (None, 0),
            (15, 15),
            (-5, 0),
            (12.7, 12),
            ("10,000", 10000),
            ("1.5M", 1500000),
            ("2.3K", 2300),
            ("invalid_count", 0),
            ([], 0),
            ({}, 0),
        ],
    )
    def test_safe_int_conversion(self, metric_input: Any, expected: int) -> None:
        """_safe_int handles text shorthand (1.5M, 2.3K), negative numbers, and garbage."""
        assert _safe_int(metric_input) == expected

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "adversarial_user_id",
        [
            None,
            "",
            "   ",
            "' OR '1'='1",
            "'; DROP TABLE users; --",
            "non-existent-user@linkx.dev",
            "not-a-valid-uuid",
        ],
    )
    async def test_adversarial_user_id_resolution(
        self, adversarial_user_id: Any
    ) -> None:
        """Resolving adversarial user_id falls back safely without SQL errors or crashes."""
        mock_session = MagicMock()
        mock_session.exec.return_value.first.return_value = None

        resolved = _resolve_user_id(user_id=adversarial_user_id, session=mock_session)
        assert isinstance(resolved, uuid.UUID)

    @pytest.mark.anyio
    async def test_resolve_user_id_handles_db_exception(self) -> None:
        """When DB session query fails inside _resolve_user_id, it falls back to uuid4."""
        mock_session = MagicMock()
        mock_session.exec.side_effect = RuntimeError("DB connection dropped")

        resolved = _resolve_user_id(user_id="user@example.com", session=mock_session)
        assert isinstance(resolved, uuid.UUID)


# ==============================================================================
# 2. BROWSER & NETWORK DISASTERS (CRASH INJECTION)
# ==============================================================================


class TestBrowserNetworkDisasters:
    """Attacks injecting TargetClosedError and alien objects at each graph node."""

    @pytest.mark.anyio
    async def test_crash_during_init_node_session_check(self) -> None:
        """BrowserManager throwing exception during session_exists is caught cleanly."""
        with patch(
            "app.services.agentic.scraping_graph.BrowserManager"
        ) as MockBrowserManager:
            instance = MockBrowserManager.return_value
            instance.session_exists.side_effect = TargetClosedError("Chrome lock error")

            state: ScrapingGraphState = {
                "user_id": "test_user",
                "page": BrokenChaosPage(),
            }
            res = await init_and_recover_session_node(state)
            assert res["status"] == "unrecoverable"
            assert res["page_state"] == "error"
            assert "Failed checking session" in str(res["error"])

    @pytest.mark.anyio
    async def test_crash_during_detect_page_state(self) -> None:
        """Page crash during detect_page_state triggers recovery or unrecoverable error."""
        broken_page = BrokenChaosPage(fail_title=True)
        with (
            patch(
                "app.services.agentic.scraping_graph.BrowserManager"
            ) as MockBrowserManager,
            patch(
                "app.services.agentic.scraping_graph.detect_page_state",
                side_effect=TargetClosedError("Target closed"),
            ),
            patch(
                "app.services.agentic.scraping_graph.recover_page_session",
                side_effect=TargetClosedError("Target closed during recovery"),
            ),
        ):
            instance = MockBrowserManager.return_value
            instance.session_exists.return_value = True

            state: ScrapingGraphState = {
                "user_id": "test_user",
                "page": broken_page,
            }
            res = await init_and_recover_session_node(state)
            assert res["status"] == "unrecoverable"
            assert res["page_state"] == "error"

    @pytest.mark.anyio
    async def test_crash_during_scrape_explore_trends(self) -> None:
        """TargetClosedError during extract_trending_sidebar returns error status."""
        broken_page = BrokenChaosPage()
        with (
            patch(
                "app.services.agentic.scraping_graph.navigate_to_trends",
                new_callable=AsyncMock,
                return_value=True,
            ),
            patch(
                "app.services.agentic.scraping_graph.extract_trending_sidebar",
                side_effect=TargetClosedError("Browser disconnected during extraction"),
            ),
        ):
            state: ScrapingGraphState = {"page": broken_page}
            res = await scrape_explore_trends_node(state)
            assert res["status"] == "error"
            assert res["scraped_topics"] == []
            assert "Browser disconnected" in str(res["error"])

    @pytest.mark.anyio
    async def test_crash_on_topic_2_after_topic_1_succeeds(self) -> None:
        """Topic 2 crashes with TargetClosedError; Topic 1 tweets are preserved and Topic 3 succeeds."""
        page = BrokenChaosPage()
        scraped_topics = [
            {"topic_title": "Topic 1", "topic_url": "https://x.com/search?q=1"},
            {"topic_title": "Topic 2", "topic_url": "https://x.com/search?q=2"},
            {"topic_title": "Topic 3", "topic_url": "https://x.com/search?q=3"},
        ]

        async def mock_extract_tweets(
            *_args: Any, topic_url: str, **_kwargs: Any
        ) -> list[dict[str, Any]]:
            if "q=2" in topic_url:
                raise TargetClosedError("Browser target died fetching Topic 2")
            return [{"author_handle": "@tester", "text": f"Tweet for {topic_url}"}]

        with (
            patch(
                "app.services.agentic.scraping_graph.extract_grok_summary",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.services.agentic.scraping_graph.extract_topic_tweets",
                side_effect=mock_extract_tweets,
            ),
        ):
            state: ScrapingGraphState = {
                "page": page,
                "scraped_topics": scraped_topics,
                "max_topics": 3,
            }
            res = await extract_topic_timelines_node(state)
            assert res["status"] == "tweets_extracted"
            assert "https://x.com/search?q=1" in res["topic_tweets_map"]
            assert "https://x.com/search?q=3" in res["topic_tweets_map"]
            assert "https://x.com/search?q=2" not in res["topic_tweets_map"]
            assert len(res["failed_topics"]) == 1
            assert "Browser target died" in res["failed_topics"][0]["reason"]

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "alien_page",
        [
            object(),
            {"url": "https://x.com/test"},
            "not_a_page_instance",
            None,
        ],
    )
    async def test_alien_page_objects_resilience(self, alien_page: Any) -> None:
        """Alien page objects do not crash extract_topic_timelines_node or scrape_explore_trends_node."""
        state: ScrapingGraphState = {
            "page": alien_page,
            "scraped_topics": [
                {"topic_title": "AI", "topic_url": "https://x.com/search?q=AI"}
            ],
            "max_topics": 1,
        }
        res_extract = await extract_topic_timelines_node(state)
        assert res_extract["status"] == "tweets_extracted"

        res_scrape = await scrape_explore_trends_node(state)
        assert res_scrape["status"] in ("error", "trends_extracted")


# ==============================================================================
# 3. SENTINEL STATE & SESSION RECOVERY STORMS
# ==============================================================================


class TestSentinelStateSessionRecoveryStorms:
    """Attacks testing recovery loops, recovery timeouts, and rapid state changes."""

    @pytest.mark.anyio
    async def test_recovery_raises_asyncio_timeout_error(self) -> None:
        """Session recovery raising asyncio.TimeoutError is shielded cleanly."""
        page = BrokenChaosPage()
        with (
            patch(
                "app.services.agentic.scraping_graph.BrowserManager"
            ) as MockBrowserManager,
            patch(
                "app.services.agentic.scraping_graph.detect_page_state",
                new_callable=AsyncMock,
                return_value="rate_limited",
            ),
            patch(
                "app.services.agentic.scraping_graph.recover_page_session",
                side_effect=asyncio.TimeoutError("Recovery timed out after 10000ms"),
            ),
        ):
            instance = MockBrowserManager.return_value
            instance.session_exists.return_value = True

            state: ScrapingGraphState = {
                "user_id": "test_user",
                "page": page,
            }
            res = await init_and_recover_session_node(state)
            assert res["status"] == "unrecoverable"
            assert res["page_state"] == "error"
            assert "Recovery timed out" in str(res["error"])

    @pytest.mark.anyio
    async def test_recovery_oscillating_state_fails(self) -> None:
        """Recovery reports unrecovered status with captcha or error."""
        page = BrokenChaosPage()
        failed_recovery = SessionRecoveryReport(
            recovered=False,
            page_state="captcha",
            overlay_type="arkose_captcha",
            status="unrecovered",
            error="Cloudflare captcha presented",
        )
        with (
            patch(
                "app.services.agentic.scraping_graph.BrowserManager"
            ) as MockBrowserManager,
            patch(
                "app.services.agentic.scraping_graph.detect_page_state",
                new_callable=AsyncMock,
                return_value="rate_limited",
            ),
            patch(
                "app.services.agentic.scraping_graph.recover_page_session",
                new_callable=AsyncMock,
                return_value=failed_recovery,
            ),
        ):
            instance = MockBrowserManager.return_value
            instance.session_exists.return_value = True

            state: ScrapingGraphState = {
                "user_id": "test_user",
                "page": page,
            }
            res = await init_and_recover_session_node(state)
            assert res["status"] == "unrecoverable"
            assert res["page_state"] == "captcha"
            assert "Cloudflare captcha" in str(res["error"])


# ==============================================================================
# 4. DOM EXTRACTION & DATA CORRUPTION ATTACKS
# ==============================================================================


class TestDomExtractionDataCorruption:
    """Attacks with missing titles, invalid URLs, null bytes, and corrupted tweet models."""

    @pytest.mark.anyio
    async def test_corrupted_raw_topics_handling(self) -> None:
        """Sidebar returns None items, empty titles, and javascript:void(0) URLs."""
        page = BrokenChaosPage()
        corrupted_raw_topics = [
            None,
            {},
            {"topic_title": None, "topic_url": None},
            {"title": "Valid Trend", "url": "https://x.com/search?q=Valid"},
            {"topic_title": "JS Topic", "topic_url": "javascript:void(0)"},
            {"topic_title": "Anchor Topic", "topic_url": "#"},
        ]

        with (
            patch(
                "app.services.agentic.scraping_graph.navigate_to_trends",
                new_callable=AsyncMock,
                return_value=True,
            ),
            patch(
                "app.services.agentic.scraping_graph.extract_trending_sidebar",
                new_callable=AsyncMock,
                return_value=corrupted_raw_topics,
            ),
        ):
            state: ScrapingGraphState = {"page": page}
            res = await scrape_explore_trends_node(state)
            assert res["status"] == "trends_extracted"
            assert len(res["scraped_topics"]) == 4

    @pytest.mark.anyio
    async def test_corrupted_tweet_payloads_parsing(self) -> None:
        """Extracting tweets with null authors, non-int metrics, and strange types."""
        page = BrokenChaosPage()
        scraped_topics = [
            {"topic_title": "AI News", "topic_url": "https://x.com/search?q=AI"}
        ]
        corrupted_raw_tweets = [
            None,
            {},
            {"author_handle": None, "author": None, "text": None},
            {
                "author": "@valid_author",
                "text": "Valid tweet text\x00with null byte",
                "replies": "15.4K",
                "retweets": "invalid",
                "likes": None,
                "views": -50,
            },
        ]

        with (
            patch(
                "app.services.agentic.scraping_graph.extract_grok_summary",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.services.agentic.scraping_graph.extract_topic_tweets",
                new_callable=AsyncMock,
                return_value=corrupted_raw_tweets,
            ),
        ):
            state: ScrapingGraphState = {
                "page": page,
                "scraped_topics": scraped_topics,
                "max_topics": 1,
            }
            res = await extract_topic_timelines_node(state)
            assert res["status"] == "tweets_extracted"
            tweets = res["topic_tweets_map"]["https://x.com/search?q=AI"]
            assert len(tweets) == 2

            # Tweet 1: Fallback values
            assert tweets[0]["author_handle"] == "unknown"
            assert tweets[0]["text"] == ""
            assert tweets[0]["replies"] == 0

            # Tweet 2: Sanitized metrics
            assert tweets[1]["author_handle"] == "@valid_author"
            assert tweets[1]["replies"] == 15400
            assert tweets[1]["retweets"] == 0
            assert tweets[1]["likes"] == 0
            assert tweets[1]["views"] == 0


# ==============================================================================
# 5. DATABASE TRANSACTION COLLISIONS & PARTIAL BATCH RESILIENCE
# ==============================================================================


class TestDatabaseTransactionCollisions:
    """Attacks testing DB IntegrityError, rollback isolation, and partial persistence."""

    @pytest.mark.anyio
    async def test_partial_batch_db_collision_with_rollback(self) -> None:
        """Topic 1 fails DB insert (IntegrityError); session rolls back and Topic 2 succeeds."""
        scraped_topics = [
            {"topic_title": "Collision Topic 1", "topic_url": "https://x.com/topic1"},
            {"topic_title": "Healthy Topic 2", "topic_url": "https://x.com/topic2"},
        ]
        topic_tweets_map = {
            "https://x.com/topic2": [
                {"author_handle": "@user", "text": "Tweet 2", "likes": 10}
            ]
        }

        mock_db_session = MagicMock()
        mock_upsert_result = MagicMock()
        mock_upsert_result.id = uuid.uuid4()

        def _upsert_side_effect(
            *_args: Any, topic_data: dict[str, Any], **_kwargs: Any
        ) -> Any:
            if "topic1" in topic_data["topic_url"]:
                raise RuntimeError("IntegrityError: UniqueViolation on topic_url")
            return mock_upsert_result

        with (
            patch(
                "app.services.agentic.scraping_graph.resolve_session"
            ) as mock_session_ctx,
            patch(
                "app.services.agentic.scraping_graph.crud.upsert_trending_topic",
                side_effect=_upsert_side_effect,
            ),
            patch(
                "app.services.agentic.scraping_graph.crud.replace_trending_tweets"
            ) as mock_replace,
        ):
            mock_session_ctx.return_value.__enter__.return_value = mock_db_session

            state: ScrapingGraphState = {
                "scraped_topics": scraped_topics,
                "topic_tweets_map": topic_tweets_map,
                "user_id": str(uuid.uuid4()),
            }

            res = await persist_scraped_batch_node(state)
            assert res["status"] == "persisted"
            assert res["persisted_topic_count"] == 1
            assert res["persisted_tweet_count"] == 1
            mock_db_session.rollback.assert_called_once()
            mock_replace.assert_called_once()

    @pytest.mark.anyio
    async def test_string_length_truncation_safety(self) -> None:
        """Extremely long topic titles, URLs, and categories are truncated to schema bounds."""
        giant_title = "A" * 2000
        giant_url = "https://x.com/" + "B" * 2000
        giant_cat = "C" * 500

        scraped_topics = [
            {
                "topic_title": giant_title,
                "topic_url": giant_url,
                "category": giant_cat,
            }
        ]

        captured_payloads: list[dict[str, Any]] = []

        def _fake_upsert(
            *_args: Any, topic_data: dict[str, Any], **_kwargs: Any
        ) -> Any:
            captured_payloads.append(topic_data)
            t = MagicMock()
            t.id = uuid.uuid4()
            return t

        with (
            patch(
                "app.services.agentic.scraping_graph.resolve_session"
            ) as mock_session_ctx,
            patch(
                "app.services.agentic.scraping_graph.crud.upsert_trending_topic",
                side_effect=_fake_upsert,
            ),
        ):
            mock_db_session = MagicMock()
            mock_session_ctx.return_value.__enter__.return_value = mock_db_session

            state: ScrapingGraphState = {
                "scraped_topics": scraped_topics,
                "user_id": str(uuid.uuid4()),
            }
            res = await persist_scraped_batch_node(state)
            assert res["status"] == "persisted"
            assert len(captured_payloads) == 1
            assert len(captured_payloads[0]["topic_title"]) <= 500
            assert len(captured_payloads[0]["topic_url"]) <= 512
            assert len(captured_payloads[0]["category"]) <= 100


# ==============================================================================
# 6. FULL PIPELINE END-TO-END CHAOS ORCHESTRATION
# ==============================================================================


class TestEndToEndChaosOrchestration:
    """Full scrape_trends_with_graph orchestration under adversarial conditions."""

    @pytest.mark.anyio
    async def test_full_pipeline_with_none_max_topics_and_sql_injection_user(
        self,
    ) -> None:
        """End-to-end invocation with max_topics=None and SQL injection user_id succeeds safely."""
        mock_page = BrokenChaosPage()
        mock_topics = [
            {"topic_title": "AI Frontier", "topic_url": "https://x.com/search?q=AI"}
        ]

        with (
            patch(
                "app.services.agentic.scraping_graph.BrowserManager"
            ) as MockBrowserManager,
            patch(
                "app.services.agentic.scraping_graph.detect_page_state",
                new_callable=AsyncMock,
                return_value="ok",
            ),
            patch(
                "app.services.agentic.scraping_graph._detect_overlay",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.services.agentic.scraping_graph.navigate_to_trends",
                new_callable=AsyncMock,
                return_value=True,
            ),
            patch(
                "app.services.agentic.scraping_graph.extract_trending_sidebar",
                new_callable=AsyncMock,
                return_value=mock_topics,
            ),
            patch(
                "app.services.agentic.scraping_graph.extract_grok_summary",
                new_callable=AsyncMock,
                return_value="Summary",
            ),
            patch(
                "app.services.agentic.scraping_graph.extract_topic_tweets",
                new_callable=AsyncMock,
                return_value=[{"author": "@user", "text": "Post"}],
            ),
            patch(
                "app.services.agentic.scraping_graph.crud.upsert_trending_topic"
            ) as mock_upsert,
            patch("app.services.agentic.scraping_graph.crud.replace_trending_tweets"),
            patch(
                "app.services.agentic.scraping_graph.resolve_session"
            ) as mock_session_ctx,
        ):
            instance = MockBrowserManager.return_value
            instance.session_exists.return_value = True
            instance.get_context.return_value = MockContextManager(mock_page)

            mock_db_session = MagicMock()
            mock_session_ctx.return_value.__enter__.return_value = mock_db_session

            fake_topic = MagicMock()
            fake_topic.id = uuid.uuid4()
            mock_upsert.return_value = fake_topic

            report = await scrape_trends_with_graph(
                user_id="'; DROP TABLE user; --",
                max_topics=None,  # type: ignore[arg-type]
                headless=True,
            )

            assert isinstance(report, ScrapedBatchReport)
            assert report.status == "persisted"
            assert report.persisted_topic_count == 1
            assert report.persisted_tweet_count == 1
