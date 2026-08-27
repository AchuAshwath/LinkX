"""Exhaustive chaos and adversarial attack suite for ScrapingGraph Orchestrator (Issue #92)."""

from __future__ import annotations

import asyncio
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.agentic.scraping_graph import (
    ScrapingGraphState,
    _parse_clamped_max_topics,
    extract_topic_timelines_node,
    init_and_recover_session_node,
    persist_scraped_batch_node,
    scrape_explore_trends_node,
)
from app.services.agentic.scraping_persistence import (
    _resolve_user_id,
    _safe_int,
)


class TargetClosedError(Exception):
    """Simulates Playwright TargetClosedError when the browser process crashes."""


class BrokenChaosPage:
    def __init__(
        self,
        *,
        url: str = "https://x.com/home",
        fail_goto: bool = False,
        fail_title: bool = False,
    ) -> None:
        self.url = url
        self.fail_goto = fail_goto
        self.fail_title = fail_title
        self.keyboard = AsyncMock()

    async def title(self) -> str:
        if self.fail_title:
            raise TargetClosedError("Page crashed while fetching title")
        return "Home / X"

    async def goto(self, url: str, *args: Any, **kwargs: Any) -> None:
        if self.fail_goto:
            raise TargetClosedError("Browser target crashed during goto")
        self.url = url

    def locator(self, selector: str) -> Any:
        loc = AsyncMock()
        loc.count = AsyncMock(return_value=0)
        loc.is_visible = AsyncMock(return_value=False)
        loc.first = loc
        loc.click = AsyncMock()
        return loc


class TestScrapingGraphChaosInputs:
    """Chaos tests attacking input parameters, boundary numbers, and type coercions."""

    @pytest.mark.parametrize(
        ("raw_input", "default", "expected"),
        [
            (None, 3, 3),
            ("invalid", 3, 3),
            (-100, 3, 1),
            (0, 3, 1),
            (1, 3, 1),
            (5, 3, 5),
            (10, 3, 10),
            (1000, 3, 10),
            ("5", 3, 5),
            ("999", 3, 10),
            (3.14, 3, 3),
            ([], 3, 3),
        ],
    )
    def test_parse_clamped_max_topics_chaos(
        self, raw_input: Any, default: int, expected: int
    ) -> None:
        assert _parse_clamped_max_topics(raw_input, default=default) == expected

    @pytest.mark.parametrize(
        ("val", "default", "expected"),
        [
            (None, 0, 0),
            (10, 0, 10),
            (-5, 0, 0),
            ("1,234", 0, 1234),
            ("  500  ", 0, 500),
            ("15.4K", 0, 15400),
            ("1.2M", 0, 1200000),
            ("invalid", 0, 0),
            ("N/A", 0, 0),
            (3.9, 0, 3),
            ({"nested": "dict"}, 0, 0),
        ],
    )
    def test_safe_int_chaos(self, val: Any, default: int, expected: int) -> None:
        assert _safe_int(val, default=default) == expected

    def test_resolve_user_id_chaos(self) -> None:
        mock_session = MagicMock()
        mock_session.exec.return_value.first.return_value = None

        u1 = _resolve_user_id(user_id=uuid.uuid4(), session=mock_session)
        assert isinstance(u1, uuid.UUID)

        u2 = _resolve_user_id(user_id="'; DROP TABLE user; --", session=mock_session)
        assert isinstance(u2, uuid.UUID)

        u3 = _resolve_user_id(user_id=None, session=mock_session)
        assert isinstance(u3, uuid.UUID)


class TestScrapingGraphChaosDisasters:
    """Disaster injection testing across Playwright lifecycle and node boundaries."""

    @pytest.mark.anyio
    async def test_alien_non_playwright_page_objects(self) -> None:
        alien_page = object()
        state: ScrapingGraphState = {"page": alien_page, "user_id": "u-1"}
        with patch("app.services.agentic.scraping_graph.BrowserManager") as p_mgr:
            p_mgr.return_value.session_exists.return_value = True
            out = await init_and_recover_session_node(state)
            assert out["status"] == "unrecoverable"

    @pytest.mark.anyio
    async def test_explore_scrape_target_closed_crash(self) -> None:
        page = BrokenChaosPage(fail_title=True)
        with patch(
            "app.services.agentic.scraping_graph.navigate_to_trends",
            side_effect=TargetClosedError("Crash"),
        ):
            out = await scrape_explore_trends_node({"page": page})
            assert out["status"] == "error"
            assert out["scraped_topics"] == []

    @pytest.mark.anyio
    async def test_extract_topic_timelines_target_closed_during_goto(self) -> None:
        page = BrokenChaosPage(fail_goto=True)
        state: ScrapingGraphState = {
            "page": page,
            "scraped_topics": [
                {"topic_url": "https://x.com/i/topics/100", "title": "Crash Topic"}
            ],
            "max_topics": 3,
        }
        with patch(
            "app.services.agentic.scraping_graph._load_selectors", return_value={}
        ):
            out = await extract_topic_timelines_node(state)
            assert out["status"] == "tweets_extracted"
            assert len(out["failed_topics"]) == 1
            assert (
                "crashed" in out["failed_topics"][0]["reason"]
                or "TargetClosedError" in out["failed_topics"][0]["reason"]
            )

    @pytest.mark.anyio
    async def test_corrupted_and_poisoned_topic_payloads(self) -> None:
        corrupted_topics = [
            None,
            {},
            {"topic_url": "javascript:void(0)", "topic_title": "JS link"},
            {"topic_url": "#", "topic_title": "Hash anchor"},
            {
                "topic_url": "https://x.com/valid",
                "topic_title": "Valid Topic \x00 with null bytes",
                "post_count": "10.5K",
            },
        ]
        mock_page = BrokenChaosPage()
        with (
            patch(
                "app.services.agentic.scraping_graph.navigate_to_trends",
                new_callable=AsyncMock,
                return_value=True,
            ),
            patch(
                "app.services.agentic.scraping_graph.extract_trending_sidebar",
                new_callable=AsyncMock,
                return_value=corrupted_topics,
            ),
            patch(
                "app.services.agentic.scraping_graph._load_selectors", return_value={}
            ),
        ):
            out = await scrape_explore_trends_node({"page": mock_page})
            assert out["status"] == "trends_extracted"
            assert len(out["scraped_topics"]) == 3
            assert out["scraped_topics"][-1]["post_count"] == "10.5K"

    @pytest.mark.anyio
    async def test_session_recovery_timeout_chaos(self) -> None:
        mock_page = BrokenChaosPage()
        state: ScrapingGraphState = {"page": mock_page, "user_id": "u-1"}
        with (
            patch("app.services.agentic.scraping_graph.BrowserManager") as p_mgr,
            patch(
                "app.services.agentic.scraping_graph.detect_page_state",
                new_callable=AsyncMock,
                return_value="rate_limited",
            ),
            patch(
                "app.services.agentic.scraping_graph._detect_overlay",
                new_callable=AsyncMock,
                return_value="notification_prompt",
            ),
            patch(
                "app.services.agentic.scraping_graph.recover_page_session",
                side_effect=asyncio.TimeoutError("Recovery timed out"),
            ),
        ):
            p_mgr.return_value.session_exists.return_value = True
            out = await init_and_recover_session_node(state)
            assert out["status"] == "unrecoverable"
            assert out["page_state"] == "error"
            assert "timed out" in (out.get("error") or "")

    @pytest.mark.anyio
    async def test_db_persistence_transaction_recovery(self) -> None:
        state: ScrapingGraphState = {
            "scraped_topics": [
                {"topic_url": "https://x.com/i/topics/1", "topic_title": "Topic 1"},
                {"topic_url": "https://x.com/i/topics/2", "topic_title": "Topic 2"},
            ],
            "topic_tweets_map": {},
            "topic_summaries": {},
            "user_id": "11111111-1111-1111-1111-111111111111",
        }
        mock_topic = MagicMock()
        mock_topic.id = uuid.uuid4()

        with (
            patch("app.services.agentic.scraping_persistence.resolve_session") as p_res,
            patch(
                "app.services.agentic.scraping_persistence.crud.upsert_trending_topic",
                side_effect=[Exception("DB Unique Violation"), mock_topic],
            ),
        ):
            mock_session = MagicMock()
            p_res.return_value.__enter__.return_value = mock_session

            out = await persist_scraped_batch_node(state)
            assert out["status"] == "persisted"
            assert out["persisted_topic_count"] == 1
            mock_session.rollback.assert_called()
