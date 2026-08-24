import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import TrendingTopic, TrendingTweet
from app.services.x_posts import (
    XPostResult,
    attach_media_file,
    enter_compose_text,
    submit_and_verify_post,
)
from scripts.scrape_trending_topics import (
    extract_topic_tweets,
    extract_trending_sidebar,
    navigate_to_trends,
)


@pytest.mark.anyio
async def test_modular_enter_compose_text_success() -> None:
    mock_locator = AsyncMock()
    mock_locator.count = AsyncMock(return_value=1)
    mock_locator.first = mock_locator
    mock_locator.is_visible = AsyncMock(return_value=True)
    mock_locator.click = AsyncMock()
    mock_locator.fill = AsyncMock()

    mock_page = MagicMock()
    mock_page.locator = MagicMock(return_value=mock_locator)

    selectors = {"compose": {"post_input": "div[data-testid='tweetTextarea_0']"}}

    with patch(
        "app.services.x_posts.HumanTyper.type", new_callable=AsyncMock
    ) as mock_type:
        success = await enter_compose_text(
            page=mock_page, text="Autonomous agents rule!", selectors=selectors
        )
        assert success is True
        mock_type.assert_awaited_once()


@pytest.mark.anyio
async def test_modular_enter_compose_text_heals_when_broken(tmp_path: Path) -> None:
    config_file = tmp_path / "x_selectors.json"
    config_file.write_text('{"compose": {"post_input": "broken"}}')

    mock_broken_locator = AsyncMock()
    mock_broken_locator.count = AsyncMock(return_value=0)
    mock_broken_locator.first = mock_broken_locator
    mock_broken_locator.is_visible = AsyncMock(return_value=False)

    mock_healed_locator = AsyncMock()
    mock_healed_locator.count = AsyncMock(return_value=1)
    mock_healed_locator.first = mock_healed_locator
    mock_healed_locator.is_visible = AsyncMock(return_value=True)
    mock_healed_locator.click = AsyncMock()
    mock_healed_locator.fill = AsyncMock()

    def locator_side_effect(sel: str) -> Any:
        return mock_healed_locator if sel == "healed" else mock_broken_locator

    mock_page = MagicMock()
    mock_page.locator = MagicMock(side_effect=locator_side_effect)

    selectors = {"compose": {"post_input": "broken"}}

    with (
        patch(
            "app.services.agentic.self_healing_graph.heal_selector",
            new_callable=AsyncMock,
        ) as mock_heal,
        patch(
            "app.services.x_posts.HumanTyper.type", new_callable=AsyncMock
        ) as mock_type,
    ):
        mock_heal.return_value = "healed"

        success = await enter_compose_text(
            page=mock_page,
            text="Healed text",
            selectors=selectors,
            config_path=config_file,
        )

        assert success is True
        mock_heal.assert_awaited_once()
        mock_type.assert_awaited_once()


@pytest.mark.anyio
async def test_modular_attach_media_file_success(tmp_path: Path) -> None:
    test_img = tmp_path / "test.png"
    test_img.write_text("fake image content")

    mock_file_input = AsyncMock()
    mock_file_input.count = AsyncMock(return_value=1)
    mock_file_input.first = mock_file_input
    mock_file_input.is_visible = AsyncMock(return_value=True)
    mock_file_input.set_input_files = AsyncMock()

    mock_page = AsyncMock()
    mock_page.locator = MagicMock(return_value=mock_file_input)
    mock_page.wait_for_selector = AsyncMock()

    selectors = {
        "compose": {
            "file_input": "input[data-testid='fileInput']",
            "attachments_container": "[data-testid='attachments']",
            "progress_bar": "[role='progressbar']",
        }
    }

    success = await attach_media_file(
        page=mock_page, image_path=str(test_img), selectors=selectors
    )
    assert success is True
    mock_file_input.set_input_files.assert_awaited_once_with(str(test_img))


@pytest.mark.anyio
async def test_modular_attach_media_file_missing_path() -> None:
    mock_page = AsyncMock()
    selectors = {"compose": {"file_input": "input[data-testid='fileInput']"}}

    success = await attach_media_file(
        page=mock_page, image_path="/nonexistent/image.png", selectors=selectors
    )
    assert success is False


@pytest.mark.anyio
async def test_modular_submit_and_verify_post_success() -> None:
    mock_btn = AsyncMock()
    mock_btn.count = AsyncMock(return_value=1)
    mock_btn.first = mock_btn
    mock_btn.is_visible = AsyncMock(return_value=True)
    mock_btn.is_enabled = AsyncMock(return_value=True)

    mock_page = AsyncMock()
    mock_page.locator = MagicMock(return_value=mock_btn)

    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.json = AsyncMock(
        return_value={
            "data": {
                "create_tweet": {"tweet_results": {"result": {"rest_id": "1234567890"}}}
            }
        }
    )

    @asynccontextmanager
    async def mock_expect_response(*_args: Any, **_kwargs: Any) -> Any:
        val = MagicMock()
        fut: asyncio.Future[Any] = asyncio.Future()
        fut.set_result(mock_response)
        val.value = fut
        yield val

    mock_page.expect_response = mock_expect_response

    selectors = {"compose": {"post_button": "button[data-testid='tweetButtonInline']"}}

    with patch(
        "app.services.browser.actions.EvasionMouse.human_click", new_callable=AsyncMock
    ) as mock_click:
        result = await submit_and_verify_post(page=mock_page, selectors=selectors)
        assert isinstance(result, XPostResult)
        assert result.success is True
        assert result.post_id == "1234567890"
        mock_click.assert_awaited_once()


@pytest.mark.anyio
async def test_modular_submit_and_verify_post_button_disabled() -> None:
    mock_btn = AsyncMock()
    mock_btn.count = AsyncMock(return_value=1)
    mock_btn.first = mock_btn
    mock_btn.is_visible = AsyncMock(return_value=True)
    mock_btn.is_enabled = AsyncMock(return_value=False)

    mock_page = AsyncMock()
    mock_page.locator = MagicMock(return_value=mock_btn)

    selectors = {"compose": {"post_button": "button[data-testid='tweetButtonInline']"}}

    result = await submit_and_verify_post(page=mock_page, selectors=selectors)
    assert result.success is False
    assert result.error == "Post button disabled or not clickable"


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
    """Test G12: Sidebar topics without an href synthesize a URL via urllib.parse.quote."""
    mock_link = AsyncMock()
    mock_link.get_attribute = AsyncMock(
        return_value=None
    )  # Modern X div[data-testid='trend'] lacks href
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
    """Test G9: _resolve_target_user fallback hierarchy across valid UUID, email, superuser, and None."""
    import uuid

    from app.models import User
    from scripts.scrape_trending_topics import _resolve_target_user

    mock_session = MagicMock()
    test_user_id = uuid.uuid4()
    test_user = User(id=test_user_id, email="admin@linkx.dev", hashed_password="fake")

    # 1. Direct valid UUID lookup
    mock_session.get.return_value = test_user
    with patch("scripts.scrape_trending_topics.Session") as mock_sess_cls:
        mock_sess_cls.return_value.__enter__.return_value = mock_session
        resolved = _resolve_target_user(str(test_user_id))
        assert resolved == test_user_id

    # 2. Email lookup when string is not a valid UUID
    mock_session.get.side_effect = ValueError("Invalid UUID")
    mock_exec = MagicMock()
    mock_exec.first.return_value = test_user
    mock_session.exec.return_value = mock_exec

    with patch("scripts.scrape_trending_topics.Session") as mock_sess_cls:
        mock_sess_cls.return_value.__enter__.return_value = mock_session
        resolved = _resolve_target_user("admin@linkx.dev")
        assert resolved == test_user_id

    # 3. None user_id falls back to FIRST_SUPERUSER
    mock_session.get.side_effect = None
    mock_session.get.return_value = None
    with patch("scripts.scrape_trending_topics.Session") as mock_sess_cls:
        mock_sess_cls.return_value.__enter__.return_value = mock_session
        resolved = _resolve_target_user(None)
        assert resolved == test_user_id


@pytest.mark.anyio
async def test_extract_candidate_summary_grok_and_fallback_selectors() -> None:
    """Test G10: _extract_candidate_summary tries Grok summary first, then falls back to summary_selectors."""
    from scripts.scrape_trending_topics import _extract_candidate_summary

    mock_page = AsyncMock()

    # 1. Primary path: Grok summary succeeds
    with patch(
        "scripts.scrape_trending_topics.extract_grok_summary",
        new_callable=AsyncMock,
        return_value="AI revolution is accelerating across software industries in 2026.",
    ):
        summary = await _extract_candidate_summary(
            mock_page, ["[data-testid='fallback']"]
        )
        assert "AI revolution" in summary

    # 2. Fallback path: Grok summary is empty, falls back to summary_selectors
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
    """Test G16: _process_single_topic returns (True, TopicFailure(reason='no_tweets')) when 0 tweets found."""
    from scripts.scrape_trending_topics import (
        TopicProcessContext,
        _process_single_topic,
    )

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
            return_value=[],  # 0 tweets
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
    """Test G17 & G18: scrape_trending_topics closes extra context pages and returns no_topics when sidebar empty."""
    from scripts.scrape_trending_topics import scrape_trending_topics

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
            "scripts.scrape_trending_topics.BrowserManager",
            return_value=mock_manager,
        ),
        patch(
            "scripts.scrape_trending_topics.detect_page_state",
            new_callable=AsyncMock,
            return_value="ok",
        ),
        patch(
            "scripts.scrape_trending_topics._extract_sidebar_links",
            new_callable=AsyncMock,
            return_value=([], {}),  # No topics found
        ),
        patch("scripts.scrape_trending_topics.random_delay", new_callable=AsyncMock),
        patch("scripts.scrape_trending_topics._resolve_target_user", return_value=None),
    ):
        result = await scrape_trending_topics()

        # G17: status is no_topics
        assert result.status == "no_topics"
        assert result.topics_found == 0

        # G18: redundant pages 1 and 2 are closed
        page_extra1.close.assert_awaited_once()
        page_extra2.close.assert_awaited_once()
