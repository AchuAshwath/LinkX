"""Tests for Modular X Scraping functions in scripts/scrape_trending_topics.py."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import TrendingTopic, TrendingTweet, User
from scripts.scrape_trending_topics import (
    TopicProcessContext,
    _extract_candidate_summary,
    _process_single_topic,
    _resolve_target_user,
    extract_topic_tweets,
    extract_trending_sidebar,
    navigate_to_trends,
    scrape_trending_topics,
)
from tests.helpers.mock_browser import build_mock_locator


@pytest.mark.anyio
async def test_modular_navigate_to_trends_success() -> None:
    mock_page = AsyncMock()
    mock_page.goto = AsyncMock()
    mock_page.url = "https://x.com/home"

    with patch(
        "app.services.browser.diagnostics.detect_page_state", new_callable=AsyncMock
    ) as mock_state:
        mock_state.return_value = "ok"
        success = await navigate_to_trends(page=mock_page)
        assert success is True
        mock_page.goto.assert_awaited_once()


@pytest.mark.anyio
async def test_modular_navigate_to_trends_logged_out() -> None:
    mock_page = AsyncMock()
    mock_page.goto = AsyncMock()
    mock_page.url = "https://x.com/i/flow/login"

    with patch(
        "app.services.browser.diagnostics.detect_page_state", new_callable=AsyncMock
    ) as mock_state:
        mock_state.return_value = "logged_out"
        success = await navigate_to_trends(page=mock_page)
        assert success is False


@pytest.mark.anyio
async def test_modular_extract_trending_sidebar() -> None:
    mock_link = AsyncMock()
    mock_link.get_attribute = AsyncMock(return_value="/search?q=LangGraph")
    mock_link.inner_text = AsyncMock(
        return_value="Technology · Trending\nLangGraph\n25.4K posts"
    )

    mock_sidebar = build_mock_locator(count=1, is_visible=True)
    mock_sidebar.locator = MagicMock(
        return_value=build_mock_locator(count=1, all_items=[mock_link])
    )

    mock_page = MagicMock()
    mock_page.locator = MagicMock(return_value=mock_sidebar)

    selectors = {
        "selectors": {
            "sidebar_container": "[data-testid='sidebarColumn']",
            "sidebar_link": "a[href*='/search?q=']",
        },
        "link_heuristic": {"exclude_texts": ["Show more"]},
    }

    topics = await extract_trending_sidebar(page=mock_page, selectors=selectors)
    assert len(topics) == 1
    assert isinstance(topics[0], TrendingTopic)
    assert "LangGraph" in topics[0].topic_title


@pytest.mark.anyio
async def test_modular_extract_topic_tweets() -> None:
    mock_page = AsyncMock()
    mock_page.goto = AsyncMock()
    mock_page.evaluate = AsyncMock(
        return_value=[
            {
                "author_handle": "@agent_builder",
                "text": "Self-healing selectors work!",
                "replies": 10,
                "retweets": 20,
                "likes": 100,
                "views": 1500,
            }
        ]
    )

    selectors = {"selectors": {"tweet_container": "[data-testid='tweet']"}}

    tweets = await extract_topic_tweets(
        page=mock_page,
        topic_url="https://x.com/search?q=AI",
        selectors=selectors,
    )

    assert len(tweets) == 1
    assert isinstance(tweets[0], TrendingTweet)
    assert tweets[0].author_handle == "@agent_builder"
    assert tweets[0].text == "Self-healing selectors work!"


@pytest.mark.anyio
async def test_modular_extract_trending_sidebar_non_href_url_synthesis() -> None:
    mock_link = AsyncMock()
    mock_link.get_attribute = AsyncMock(return_value=None)
    mock_link.inner_text = AsyncMock(
        return_value="Sports · Trending\nReal Madrid & Barcelona\n120K posts"
    )

    mock_links_locator = MagicMock()
    mock_links_locator.all = AsyncMock(return_value=[mock_link])

    mock_sidebar = MagicMock()
    mock_sidebar.count = AsyncMock(return_value=1)
    mock_sidebar.first = mock_sidebar
    mock_sidebar.is_visible = AsyncMock(return_value=True)
    mock_sidebar.locator = MagicMock(return_value=mock_links_locator)

    mock_page = MagicMock()
    mock_page.locator = MagicMock(return_value=mock_sidebar)

    selectors = {
        "selectors": {
            "sidebar_container": "[data-testid='sidebarColumn']",
            "sidebar_link": "[data-testid='trend']",
        },
        "link_heuristic": {"must_contain_newline": False},
    }

    topics = await extract_trending_sidebar(page=mock_page, selectors=selectors)
    assert len(topics) == 1
    assert topics[0].topic_title == "Real Madrid & Barcelona"
    assert (
        "https://x.com/search?q=Real%20Madrid%20%26%20Barcelona" == topics[0].topic_url
    )


def test_resolve_target_user_fallback_hierarchy() -> None:
    mock_session = MagicMock()
    test_user_id = uuid.uuid4()
    test_user = User(id=test_user_id, email="admin@linkx.dev", hashed_password="fake")

    mock_session.get.return_value = test_user
    with patch("scripts.scrape_trending_topics.Session") as mock_sess_cls:
        mock_sess_cls.return_value.__enter__.return_value = mock_session
        resolved = _resolve_target_user(str(test_user_id))
        assert resolved == test_user_id

    mock_session.get.side_effect = ValueError("Invalid UUID")
    mock_exec = MagicMock()
    mock_exec.first.return_value = test_user
    mock_session.exec.return_value = mock_exec

    with patch("scripts.scrape_trending_topics.Session") as mock_sess_cls:
        mock_sess_cls.return_value.__enter__.return_value = mock_session
        resolved = _resolve_target_user("admin@linkx.dev")
        assert resolved == test_user_id

    mock_session.get.side_effect = None
    mock_session.get.return_value = None
    with patch("scripts.scrape_trending_topics.Session") as mock_sess_cls:
        mock_sess_cls.return_value.__enter__.return_value = mock_session
        resolved = _resolve_target_user(None)
        assert resolved == test_user_id


@pytest.mark.anyio
async def test_extract_candidate_summary_grok_and_fallback_selectors() -> None:
    mock_page = AsyncMock()

    with patch(
        "scripts.scrape_trending_topics.extract_grok_summary",
        new_callable=AsyncMock,
        return_value="AI revolution is accelerating across software industries in 2026.",
    ):
        summary = await _extract_candidate_summary(
            mock_page, ["[data-testid='fallback']"]
        )
        assert "AI revolution" in summary

    mock_fallback_elem = AsyncMock()
    mock_fallback_elem.count = AsyncMock(return_value=1)
    mock_fallback_elem.first = mock_fallback_elem
    mock_fallback_elem.inner_text = AsyncMock(
        return_value="Detailed event breakdown summary explaining the current market moves."
    )
    mock_page.locator = MagicMock(return_value=mock_fallback_elem)

    with patch(
        "scripts.scrape_trending_topics.extract_grok_summary",
        new_callable=AsyncMock,
        return_value="",
    ):
        summary_fallback = await _extract_candidate_summary(
            mock_page, ["[data-testid='eventSummary']"]
        )
        assert (
            summary_fallback
            == "Detailed event breakdown summary explaining the current market moves."
        )


@pytest.mark.anyio
async def test_process_single_topic_no_tweets_failure() -> None:
    mock_page = AsyncMock()
    mock_page.url = "https://x.com/search?q=EmptyTopic"
    mock_mouse = AsyncMock()

    ctx = TopicProcessContext(
        page=mock_page,
        mouse=mock_mouse,
        target_id="/search?q=EmptyTopic",
        target_title="Empty Topic",
        is_href=True,
        db_user_id=None,
        config={},
    )

    with (
        patch(
            "scripts.scrape_trending_topics._navigate_and_verify_topic",
            new_callable=AsyncMock,
            return_value=(True, None),
        ),
        patch(
            "scripts.scrape_trending_topics._extract_candidate_summary",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "scripts.scrape_trending_topics._scrape_topic_tweets",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch("scripts.scrape_trending_topics.random_delay", new_callable=AsyncMock),
    ):
        ok, failure = await _process_single_topic(ctx)
        assert ok is True
        assert failure is not None
        assert failure.reason == "no_tweets"


@pytest.mark.anyio
async def test_scrape_trending_topics_no_topics_status_and_closes_redundant_pages() -> (
    None
):
    page_main = AsyncMock()
    page_main.goto = AsyncMock()
    page_extra1 = AsyncMock()
    page_extra2 = AsyncMock()

    mock_context = AsyncMock()
    mock_context.pages = [page_main, page_extra1, page_extra2]

    mock_manager = MagicMock()
    mock_manager.get_context = MagicMock(
        return_value=AsyncMock(
            __aenter__=AsyncMock(return_value=mock_context),
            __aexit__=AsyncMock(return_value=None),
        )
    )

    with (
        patch(
            "scripts.scrape_trending_topics.BrowserManager", return_value=mock_manager
        ),
        patch(
            "scripts.scrape_trending_topics.detect_page_state",
            new_callable=AsyncMock,
            return_value="ok",
        ),
        patch(
            "scripts.scrape_trending_topics._extract_sidebar_links",
            new_callable=AsyncMock,
            return_value=([], {}),
        ),
        patch("scripts.scrape_trending_topics.random_delay", new_callable=AsyncMock),
        patch("scripts.scrape_trending_topics._resolve_target_user", return_value=None),
    ):
        result = await scrape_trending_topics()
        assert result.status == "no_topics"
        assert result.topics_found == 0
        page_extra1.close.assert_awaited_once()
        page_extra2.close.assert_awaited_once()
