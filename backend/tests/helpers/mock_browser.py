"""Reusable mock builders for Playwright browser testing across chaos and unit suites."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock


def build_mock_locator(
    *,
    count: int = 0,
    is_visible: bool = False,
    inner_text: str = "",
    all_items: list[Any] | None = None,
) -> MagicMock:
    """Helper to construct Playwright-like async locators with <= 4 arguments."""
    loc = MagicMock()
    loc.count = AsyncMock(return_value=count)
    loc.is_visible = AsyncMock(return_value=is_visible)
    loc.inner_text = AsyncMock(return_value=inner_text)
    loc.first = loc
    loc.nth = MagicMock(return_value=loc)
    loc.all = AsyncMock(
        return_value=all_items
        if all_items is not None
        else ([loc] * count if count > 0 else [])
    )
    loc.filter = MagicMock(return_value=loc)
    loc.click = AsyncMock()
    loc.evaluate = AsyncMock()
    return loc


def build_mock_tweet_locator(text: str) -> MagicMock:
    """Helper to construct a tweet article locator."""
    tweet = MagicMock()
    tweet_text_loc = build_mock_locator(count=1, is_visible=True, inner_text=text)
    show_more_loc = build_mock_locator(count=0, is_visible=False)

    def loc_fn(selector: str) -> Any:
        if "tweet-text-show-more-link" in selector:
            return show_more_loc
        if "tweetText" in selector:
            return tweet_text_loc
        return build_mock_locator(count=0, is_visible=False)

    tweet.locator = MagicMock(side_effect=loc_fn)
    tweet.inner_text = AsyncMock(return_value=text)
    return tweet
