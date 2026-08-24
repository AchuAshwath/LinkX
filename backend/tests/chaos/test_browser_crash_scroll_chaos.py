"""Chaos and adversarial testing suite for browser scrolling resilience, zombie locators, and crashes.

Attack vectors tested:
1. Infinite Scroll & Zombie Locators:
   - Empty timeline bounded termination.
   - Infinite duplicate tweets deduplication & author saturation capping.
   - Zombie locators & DOM detachment handling.
   - extract_topic_tweets robustness against malformed DOM or evaluate outputs.

2. Browser Crash & Target Closed Mid-Action:
   - Page/Browser crash during find_or_heal_element.
   - EvasionMouse idle background loop resilience to target closed.
   - EvasionMouse human_click lock release on timeout.
   - scrape_trending_topics clean abort status on TargetClosedError.
   - BrowserManager singleton lock handling.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from rebrowser_playwright.async_api import Error as PlaywrightError

from app.services.browser.actions import EvasionMouse, PostButtonDisabledError
from app.services.browser.manager import (
    _clean_stale_singleton_locks,
    _handle_launch_error,
)
from app.services.browser.tools import (
    SelectorHealingError,
    find_or_heal_element,
)
from scripts.scrape_trending_topics import (
    TopicProcessContext,
    _expand_tweet,
    _scrape_topic_tweets,
    extract_topic_tweets,
    extract_tweet_data,
    scrape_trending_topics,
)


def _build_mock_locator(
    *, count: int = 1, all_items: list[Any] | None = None
) -> AsyncMock:
    loc = AsyncMock()
    loc.count = AsyncMock(return_value=count)
    loc.first = AsyncMock()
    loc.first.count = AsyncMock(return_value=count)
    loc.all = AsyncMock(
        return_value=all_items if all_items is not None else [AsyncMock()] * count
    )
    loc.is_visible = AsyncMock(return_value=True)
    return loc


def _build_mock_tweet(
    *, text: str = "Tweet text", raw: str = "@user\nTweet text\n1\n2\n3\n4"
) -> AsyncMock:
    t = AsyncMock()
    text_loc = AsyncMock()
    text_loc.count = AsyncMock(return_value=1)
    text_loc.inner_text = AsyncMock(return_value=text)
    text_loc.first = text_loc

    empty = AsyncMock()
    empty.count = AsyncMock(return_value=0)
    empty.first = empty
    empty.filter = MagicMock(return_value=empty)

    def sub_locator(sel: str) -> AsyncMock:
        if "tweetText" in sel:
            return text_loc
        return empty

    t.locator = MagicMock(side_effect=sub_locator)
    t.inner_text = AsyncMock(return_value=raw)
    return t


class TestInfiniteScrollAndZombieLocators:
    """Chaos tests attacking timeline scrolling, empty feeds, and detached DOM nodes."""

    @pytest.mark.anyio
    async def test_empty_timeline_infinite_scroll_bounded_termination(self) -> None:
        mock_page = AsyncMock()
        mock_locator = _build_mock_locator(count=0, all_items=[])
        mock_page.locator = MagicMock(return_value=mock_locator)

        mock_mouse = AsyncMock()
        mock_mouse.human_scroll = AsyncMock()

        ctx = TopicProcessContext(
            page=mock_page,
            mouse=mock_mouse,
            target_id="/search?q=EmptyTopic",
            target_title="Empty Topic",
            is_href=True,
            db_user_id=None,
            config={"scrolls_per_topic": 3},
        )

        with (
            patch(
                "scripts.scrape_trending_topics.random_delay", new_callable=AsyncMock
            ),
            patch(
                "scripts.scrape_trending_topics.simulate_reading",
                new_callable=AsyncMock,
            ),
        ):
            conversations = await _scrape_topic_tweets(
                ctx=ctx, tweet_selector="[data-testid='tweet']"
            )

            assert len(conversations) == 0
            assert mock_mouse.human_scroll.await_count == 3

    @pytest.mark.anyio
    async def test_stuck_timeline_duplicate_tweets_and_author_saturation(self) -> None:
        t1 = _build_mock_tweet(
            text="Spam tweet 1", raw="@spammer\nSpam tweet 1\n10\n20\n30\n40"
        )
        t2 = _build_mock_tweet(
            text="Spam tweet 2", raw="@spammer\nSpam tweet 2\n10\n20\n30\n40"
        )
        t3 = _build_mock_tweet(
            text="Spam tweet 3", raw="@spammer\nSpam tweet 3\n10\n20\n30\n40"
        )
        t4 = _build_mock_tweet(
            text="Legitimate tweet", raw="@legit_user\nLegitimate tweet\n10\n20\n30\n40"
        )

        mock_page = AsyncMock()
        mock_page.locator = MagicMock(
            return_value=_build_mock_locator(count=4, all_items=[t1, t2, t3, t4])
        )

        mock_mouse = AsyncMock()
        mock_mouse.human_scroll = AsyncMock()

        ctx = TopicProcessContext(
            page=mock_page,
            mouse=mock_mouse,
            target_id="/search?q=SpamTopic",
            target_title="Spam Topic",
            is_href=True,
            db_user_id=None,
            config={"scrolls_per_topic": 2},
        )

        with (
            patch(
                "scripts.scrape_trending_topics.random_delay", new_callable=AsyncMock
            ),
            patch(
                "scripts.scrape_trending_topics.simulate_reading",
                new_callable=AsyncMock,
            ),
        ):
            conversations = await _scrape_topic_tweets(
                ctx=ctx, tweet_selector="[data-testid='tweet']"
            )

            assert len(conversations) == 3
            authors = [c["author"] for c in conversations]
            assert authors.count("@spammer") == 2
            assert authors.count("@legit_user") == 1

    @pytest.mark.anyio
    async def test_zombie_locator_dom_detachment_during_tweet_extraction(self) -> None:
        mock_detached_locator = AsyncMock()
        mock_detached_locator.locator = MagicMock(
            side_effect=PlaywrightError(
                "Element is not attached to the DOM, node destroyed"
            )
        )
        mock_detached_locator.inner_text = AsyncMock(
            side_effect=PlaywrightError(
                "Target page, context or browser has been closed"
            )
        )

        await _expand_tweet(mock_detached_locator)
        data = await extract_tweet_data(mock_detached_locator)
        assert data is None

    @pytest.mark.anyio
    async def test_extract_topic_tweets_malformed_evaluate_resilience(self) -> None:
        mock_page = AsyncMock()
        mock_page.url = "https://x.com/search?q=Test"

        mock_page.evaluate = AsyncMock(return_value=None)
        tweets_none = await extract_topic_tweets(
            page=mock_page,
            topic_url="https://x.com/search?q=Test",
            selectors={"selectors": {"tweet_container": "[data-testid='tweet']"}},
        )
        assert tweets_none == []

        mock_page.evaluate = AsyncMock(
            return_value=[
                {"author_handle": "@test"},
                {"text": "just text"},
                {},
            ]
        )
        tweets_malformed = await extract_topic_tweets(
            page=mock_page,
            topic_url="https://x.com/search?q=Test",
            selectors={"selectors": {"tweet_container": "[data-testid='tweet']"}},
        )
        assert len(tweets_malformed) == 3
        assert tweets_malformed[0].author_handle == "@test"
        assert tweets_malformed[1].author_handle == "unknown"


class TestBrowserCrashAndTargetClosed:
    """Chaos tests probing process termination, crashed targets, and unhandled task crashes."""

    @pytest.mark.anyio
    async def test_page_crash_target_closed_during_find_or_heal_element(
        self, tmp_path: Path
    ) -> None:
        config_file = tmp_path / "scrape_config.json"
        config_file.write_text('{"compose": {"post_input": "button#submit"}}')

        mock_page = AsyncMock()
        mock_page.url = "https://x.com/home"
        mock_page.locator = MagicMock(
            side_effect=PlaywrightError(
                "PlaywrightError: Target page, context or browser has been closed"
            )
        )
        mock_page.evaluate = AsyncMock(
            side_effect=PlaywrightError(
                "PlaywrightError: Target page, context or browser has been closed"
            )
        )

        selectors_dict = {"compose": {"post_input": "button#submit"}}

        with pytest.raises(SelectorHealingError) as exc_info:
            await find_or_heal_element(
                page=mock_page,
                selector_key="compose.post_input",
                selectors_dict=selectors_dict,
                config_path=config_file,
            )

        assert "compose.post_input" in str(exc_info.value)

    @pytest.mark.anyio
    async def test_evasion_mouse_idle_loop_target_closed_clean_exit(self) -> None:
        mock_page = AsyncMock()
        mock_page.viewport_size = {"width": 1280, "height": 800}
        mock_page.mouse.move = AsyncMock(
            side_effect=PlaywrightError(
                "Target page, context or browser has been closed"
            )
        )

        mouse = EvasionMouse(mock_page)

        def mock_uniform(a: float, b: float) -> float:
            if b <= 5.0 and a >= 0.5:
                return 0.001
            if b == 50 and a == -50:
                return 25.0
            return 0.001

        with patch("random.uniform", side_effect=mock_uniform):
            await mouse.start_idle()
            await asyncio.sleep(0.05)

        assert mouse._is_idling is False
        assert mouse._idle_task is None or mouse._idle_task.done()
        await mouse.stop_idle()

    @pytest.mark.anyio
    async def test_evasion_mouse_human_click_lock_release_on_timeout(self) -> None:
        mock_page = AsyncMock()
        mock_page.viewport_size = {"width": 1280, "height": 800}
        mock_page.wait_for_selector = AsyncMock()

        mock_elem = AsyncMock()
        mock_elem.scroll_into_view_if_needed = AsyncMock()
        mock_elem.bounding_box = AsyncMock(
            return_value={"x": 100, "y": 100, "width": 50, "height": 50}
        )
        from playwright.async_api import TimeoutError as PlaywrightTimeoutError

        mock_elem.click = AsyncMock(
            side_effect=PlaywrightTimeoutError(
                "Timeout 5000ms waiting for actionability"
            )
        )

        mock_page.locator = MagicMock(return_value=AsyncMock(first=mock_elem))
        mouse = EvasionMouse(mock_page)

        with pytest.raises(PostButtonDisabledError):
            await mouse.human_click(selector="button[data-testid='tweetButton']")

        assert not mouse.lock.locked()
        assert mouse._is_idling is True
        await mouse.stop_idle()

    @pytest.mark.anyio
    async def test_scrape_trending_topics_target_closed_aborted_status(self) -> None:
        mock_page = AsyncMock()
        mock_page.url = "https://x.com/home"
        mock_page.goto = AsyncMock(
            side_effect=PlaywrightError(
                "PlaywrightError: Target page, context or browser has been closed"
            )
        )

        mock_context = AsyncMock()
        mock_context.pages = [mock_page]

        mock_manager = MagicMock()
        mock_manager.get_context = MagicMock(
            return_value=AsyncMock(
                __aenter__=AsyncMock(return_value=mock_context),
                __aexit__=AsyncMock(return_value=None),
            )
        )

        with (
            patch(
                "scripts.scrape_trending_topics.BrowserManager",
                return_value=mock_manager,
            ),
            patch(
                "scripts.scrape_trending_topics.random_delay", new_callable=AsyncMock
            ),
            patch(
                "scripts.scrape_trending_topics._resolve_target_user", return_value=None
            ),
        ):
            result = await scrape_trending_topics()

            assert result.status == "aborted"
            assert len(result.errors) > 0
            assert "closed" in result.errors[0].lower()

    def test_browser_manager_launch_singleton_lock_handling(
        self, tmp_path: Path
    ) -> None:
        session_dir = tmp_path / "x_session"
        session_dir.mkdir(parents=True)
        lock_file = session_dir / "SingletonLock"
        lock_file.write_text("lock_content")

        with patch(
            "app.services.browser.manager.is_chrome_running", return_value=False
        ):
            _clean_stale_singleton_locks(session_dir)
            assert not lock_file.exists()

        with pytest.raises(RuntimeError) as exc_info:
            _handle_launch_error(
                Exception(
                    "ProcessSingleton: The profile appears to be in use by another Google Chrome process"
                )
            )
        assert "Google Chrome is currently open" in str(exc_info.value)
