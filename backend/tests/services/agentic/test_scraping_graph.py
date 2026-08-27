"""Unit and integration tests for ScrapingGraph Orchestrator (Issue #92)."""

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langgraph.graph import END

from app.models import TrendingTopic, TrendingTweet
from app.services.agentic.schemas import ScrapedBatchReport, SessionRecoveryReport
from app.services.agentic.scraping_graph import (
    ScrapingGraphState,
    _load_selectors,
    _resolve_user_id,
    _route_after_session_check,
    build_scraping_graph,
    extract_topic_timelines_node,
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
    """Mock Playwright BrowserContext."""

    def __init__(self, page: MockPage) -> None:
        self.pages = [page]

    async def new_page(self) -> MockPage:
        return self.pages[0]

    async def close(self) -> None:
        pass


class MockContextManager:
    """Context manager returning mock context."""

    def __init__(self, context: MockContext) -> None:
        self.context = context

    async def __aenter__(self) -> MockContext:
        return self.context

    async def __aexit__(self, *args: Any) -> None:
        pass


# --- Slice 1: Happy Path Clean Explore Scraping & Persistence ---


@pytest.mark.anyio
async def test_slice_1_happy_path_scraping_and_persistence() -> None:
    """Slice 1: Clean page -> scrapes explore trends, extracts timelines, persists to DB."""
    user_id = str(uuid.uuid4())
    mock_page = MockPage(url="https://x.com/home")
    mock_context = MockContext(mock_page)

    mock_topics = [
        TrendingTopic(
            id=uuid.uuid4(),
            user_id=uuid.UUID(user_id),
            topic_url="https://x.com/search?q=Artificial+Intelligence",
            topic_title="Artificial Intelligence",
            category="Technology",
            post_count=12000,
        ),
        TrendingTopic(
            id=uuid.uuid4(),
            user_id=uuid.UUID(user_id),
            topic_url="https://x.com/search?q=Quantum+Computing",
            topic_title="Quantum Computing",
            category="Science",
            post_count=8500,
        ),
    ]

    mock_tweets_topic_1 = [
        TrendingTweet(
            id=uuid.uuid4(),
            topic_id=mock_topics[0].id,
            author_handle="@ai_insider",
            text="New frontier model released today!",
            likes=150,
            retweets=45,
        ),
        TrendingTweet(
            id=uuid.uuid4(),
            topic_id=mock_topics[0].id,
            author_handle="@tech_guru",
            text="Deep reasoning benchmarks show huge gains.",
            likes=90,
            retweets=20,
        ),
    ]

    mock_tweets_topic_2 = [
        TrendingTweet(
            id=uuid.uuid4(),
            topic_id=mock_topics[1].id,
            author_handle="@quantum_dev",
            text="Quantum coherence record shattered.",
            likes=300,
            retweets=80,
        )
    ]

    async def mock_extract_tweets(
        *_args: Any, topic_url: str, **_kwargs: Any
    ) -> list[TrendingTweet]:
        if "Artificial+Intelligence" in topic_url:
            return mock_tweets_topic_1
        return mock_tweets_topic_2

    async def mock_grok_summary(page: Any) -> str:
        if "Artificial+Intelligence" in page.url:
            return "Discussions regarding the latest AI frontier model release."
        return "Quantum physics community celebrates coherence milestone."

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
            side_effect=mock_grok_summary,
        ),
        patch(
            "app.services.agentic.scraping_graph.extract_topic_tweets",
            side_effect=mock_extract_tweets,
        ),
        patch(
            "app.services.agentic.scraping_graph.crud.upsert_trending_topic"
        ) as mock_upsert,
        patch(
            "app.services.agentic.scraping_graph.crud.replace_trending_tweets"
        ) as mock_replace_tweets,
        patch(
            "app.services.agentic.scraping_graph.resolve_session"
        ) as mock_session_ctx,
    ):
        instance = MockBrowserManager.return_value
        instance.session_exists.return_value = True
        instance.get_context.return_value = MockContextManager(mock_context)

        # Mock DB session
        mock_db_session = MagicMock()
        mock_session_ctx.return_value.__enter__.return_value = mock_db_session

        # Return mock topic with id for upsert
        def _fake_upsert(*_args: Any, **_kwargs: Any) -> Any:
            t = MagicMock()
            t.id = uuid.uuid4()
            return t

        mock_upsert.side_effect = _fake_upsert

        report = await scrape_trends_with_graph(
            user_id=user_id,
            max_topics=2,
            headless=True,
        )

        assert isinstance(report, ScrapedBatchReport)
        assert report.status == "persisted"
        assert report.page_state == "ok"
        assert report.persisted_topic_count == 2
        assert report.persisted_tweet_count == 3
        assert len(report.scraped_topics) == 2
        assert len(report.failed_topics) == 0
        assert report.error is None
        assert mock_upsert.call_count == 2
        assert mock_replace_tweets.call_count == 2


# --- Slice 2: No Stored Session Immediate Abort ---


@pytest.mark.anyio
async def test_slice_2_no_stored_session_immediate_abort() -> None:
    """Slice 2: No session on disk -> immediate unrecoverable abort without browser launch."""
    user_id = "user_no_session"

    with patch(
        "app.services.agentic.scraping_graph.BrowserManager"
    ) as MockBrowserManager:
        instance = MockBrowserManager.return_value
        instance.session_exists.return_value = False

        report = await scrape_trends_with_graph(user_id=user_id)

        assert isinstance(report, ScrapedBatchReport)
        assert report.status == "unrecoverable"
        assert report.page_state == "logged_out"
        assert report.error == "No stored X.com session found"
        assert report.persisted_topic_count == 0
        assert report.persisted_tweet_count == 0
        instance.get_context.assert_not_called()


# --- Slice 3: Unrecoverable Auth Redirect ---


@pytest.mark.anyio
@pytest.mark.parametrize(
    "auth_url", ["https://x.com/login", "https://x.com/i/flow/login"]
)
async def test_slice_3_auth_redirect_abort(auth_url: str) -> None:
    """Slice 3: Auth redirect (logged_out) -> terminates at conditional edge without scraping."""
    user_id = str(uuid.uuid4())
    mock_page = MockPage(url=auth_url)
    mock_context = MockContext(mock_page)

    with (
        patch(
            "app.services.agentic.scraping_graph.BrowserManager"
        ) as MockBrowserManager,
        patch(
            "app.services.agentic.scraping_graph.detect_page_state",
            new_callable=AsyncMock,
            return_value="logged_out",
        ),
        patch(
            "app.services.agentic.scraping_graph.navigate_to_trends",
            new_callable=AsyncMock,
        ) as mock_nav,
    ):
        instance = MockBrowserManager.return_value
        instance.session_exists.return_value = True
        instance.get_context.return_value = MockContextManager(mock_context)

        report = await scrape_trends_with_graph(user_id=user_id)

        assert report.status == "unrecoverable"
        assert report.page_state == "logged_out"
        assert "logged_out" in str(report.error)
        assert report.persisted_topic_count == 0
        mock_nav.assert_not_called()


# --- Slice 4: CAPTCHA / Bot Challenge Immediate Abort ---


@pytest.mark.anyio
async def test_slice_4_captcha_challenge_abort() -> None:
    """Slice 4: CAPTCHA challenge -> terminates at conditional edge without scraping."""
    user_id = str(uuid.uuid4())
    mock_page = MockPage(url="https://x.com/account/access", title="Security Check")
    mock_context = MockContext(mock_page)

    with (
        patch(
            "app.services.agentic.scraping_graph.BrowserManager"
        ) as MockBrowserManager,
        patch(
            "app.services.agentic.scraping_graph.detect_page_state",
            new_callable=AsyncMock,
            return_value="captcha",
        ),
        patch(
            "app.services.agentic.scraping_graph.navigate_to_trends",
            new_callable=AsyncMock,
        ) as mock_nav,
    ):
        instance = MockBrowserManager.return_value
        instance.session_exists.return_value = True
        instance.get_context.return_value = MockContextManager(mock_context)

        report = await scrape_trends_with_graph(user_id=user_id)

        assert report.status == "unrecoverable"
        assert report.page_state == "captcha"
        assert "captcha" in str(report.error)
        assert report.persisted_topic_count == 0
        mock_nav.assert_not_called()


# --- Slice 5: Modal Overlay Auto-Recovery by SessionRecoveryGraph ---


@pytest.mark.anyio
async def test_slice_5_modal_overlay_auto_recovery() -> None:
    """Slice 5: Modal overlay detected -> recovered by SessionRecoveryGraph and scraping succeeds."""
    user_id = str(uuid.uuid4())
    mock_page = MockPage(url="https://x.com/home", overlay="notification_prompt")
    mock_context = MockContext(mock_page)

    recovery_report = SessionRecoveryReport(
        recovered=True,
        page_state="ok",
        overlay_type="notification_prompt",
        dismiss_attempted=True,
        recovery_action="click_not_now",
        status="recovered",
    )

    mock_topics = [
        TrendingTopic(
            id=uuid.uuid4(),
            user_id=uuid.UUID(user_id),
            topic_url="https://x.com/search?q=Python+Release",
            topic_title="Python Release",
            category="Technology",
            post_count=5000,
        )
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
            return_value="notification_prompt",
        ),
        patch(
            "app.services.agentic.scraping_graph.recover_page_session",
            new_callable=AsyncMock,
            return_value=recovery_report,
        ) as mock_rec,
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
            return_value="Summary text",
        ),
        patch(
            "app.services.agentic.scraping_graph.extract_topic_tweets",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch(
            "app.services.agentic.scraping_graph.crud.upsert_trending_topic"
        ) as mock_upsert,
        patch(
            "app.services.agentic.scraping_graph.resolve_session"
        ) as mock_session_ctx,
    ):
        instance = MockBrowserManager.return_value
        instance.session_exists.return_value = True
        instance.get_context.return_value = MockContextManager(mock_context)

        mock_db_session = MagicMock()
        mock_session_ctx.return_value.__enter__.return_value = mock_db_session

        fake_topic = MagicMock()
        fake_topic.id = uuid.uuid4()
        mock_upsert.return_value = fake_topic

        report = await scrape_trends_with_graph(user_id=user_id)

        assert report.status == "persisted"
        assert report.page_state == "ok"
        assert report.session_recovery is not None
        assert report.session_recovery.get("recovered") is True
        assert report.session_recovery.get("overlay_type") == "notification_prompt"
        assert report.persisted_topic_count == 1
        mock_rec.assert_called_once()


# --- Slice 6: SessionRecoveryGraph Fails to Recover ---


@pytest.mark.anyio
async def test_slice_6_session_recovery_fails() -> None:
    """Slice 6: Overlay dismissal fails -> unrecoverable abort without scraping."""
    user_id = str(uuid.uuid4())
    mock_page = MockPage(url="https://x.com/home", overlay="unknown_blocking_modal")
    mock_context = MockContext(mock_page)

    failed_recovery = SessionRecoveryReport(
        recovered=False,
        page_state="modal_overlay",
        overlay_type="unknown_blocking_modal",
        dismiss_attempted=True,
        recovery_action="press_escape",
        status="unrecovered",
        error="Modal failed to dismiss",
    )

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
            return_value="unknown_blocking_modal",
        ),
        patch(
            "app.services.agentic.scraping_graph.recover_page_session",
            new_callable=AsyncMock,
            return_value=failed_recovery,
        ),
        patch(
            "app.services.agentic.scraping_graph.navigate_to_trends",
            new_callable=AsyncMock,
        ) as mock_nav,
    ):
        instance = MockBrowserManager.return_value
        instance.session_exists.return_value = True
        instance.get_context.return_value = MockContextManager(mock_context)

        report = await scrape_trends_with_graph(user_id=user_id)

        assert report.status == "unrecoverable"
        assert report.page_state == "modal_overlay"
        assert report.session_recovery is not None
        assert report.session_recovery.get("recovered") is False
        assert "Modal failed to dismiss" in str(report.error)
        assert report.persisted_topic_count == 0
        mock_nav.assert_not_called()


# --- Slice 7: Partial Batch Resilience (1 of 3 Topics Times Out) ---


@pytest.mark.anyio
async def test_slice_7_partial_batch_resilience() -> None:
    """Slice 7: Topic 2 times out during tweet extraction -> Topics 1 and 3 are persisted successfully."""
    user_id = str(uuid.uuid4())
    mock_page = MockPage(url="https://x.com/home")
    mock_context = MockContext(mock_page)

    mock_topics = [
        TrendingTopic(
            id=uuid.uuid4(),
            user_id=uuid.UUID(user_id),
            topic_url="https://x.com/search?q=Topic+1",
            topic_title="Topic 1",
        ),
        TrendingTopic(
            id=uuid.uuid4(),
            user_id=uuid.UUID(user_id),
            topic_url="https://x.com/search?q=Topic+2",
            topic_title="Topic 2",
        ),
        TrendingTopic(
            id=uuid.uuid4(),
            user_id=uuid.UUID(user_id),
            topic_url="https://x.com/search?q=Topic+3",
            topic_title="Topic 3",
        ),
    ]

    async def mock_extract_tweets_with_failure(
        *_args: Any, topic_url: str, **_kwargs: Any
    ) -> list[TrendingTweet]:
        if "Topic+2" in topic_url:
            raise TimeoutError("Timed out waiting for tweet elements")
        return [
            TrendingTweet(
                id=uuid.uuid4(),
                topic_id=uuid.uuid4(),
                author_handle="@user",
                text=f"Tweet for {topic_url}",
            )
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
            side_effect=mock_extract_tweets_with_failure,
        ),
        patch(
            "app.services.agentic.scraping_graph.crud.upsert_trending_topic"
        ) as mock_upsert,
        patch(
            "app.services.agentic.scraping_graph.crud.replace_trending_tweets"
        ) as mock_replace_tweets,
        patch(
            "app.services.agentic.scraping_graph.resolve_session"
        ) as mock_session_ctx,
    ):
        instance = MockBrowserManager.return_value
        instance.session_exists.return_value = True
        instance.get_context.return_value = MockContextManager(mock_context)

        mock_db_session = MagicMock()
        mock_session_ctx.return_value.__enter__.return_value = mock_db_session

        fake_topic = MagicMock()
        fake_topic.id = uuid.uuid4()
        mock_upsert.return_value = fake_topic

        report = await scrape_trends_with_graph(user_id=user_id, max_topics=3)

        assert report.status == "persisted"
        assert len(report.failed_topics) == 1
        assert report.failed_topics[0]["topic_url"] == "https://x.com/search?q=Topic+2"
        assert "Timed out" in report.failed_topics[0]["reason"]
        # Topics are all persisted, but topic 2 has 0 tweets
        assert report.persisted_topic_count == 3
        assert report.persisted_tweet_count == 2
        assert mock_replace_tweets.call_count == 2


# --- Slice 8: Empty Explore Page ---


@pytest.mark.anyio
async def test_slice_8_empty_explore_page() -> None:
    """Slice 8: Empty explore page -> cleanly returns 0 topics without errors."""
    user_id = str(uuid.uuid4())
    mock_page = MockPage(url="https://x.com/home")
    mock_context = MockContext(mock_page)

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
            return_value=[],
        ),
    ):
        instance = MockBrowserManager.return_value
        instance.session_exists.return_value = True
        instance.get_context.return_value = MockContextManager(mock_context)

        report = await scrape_trends_with_graph(user_id=user_id)

        assert report.status == "persisted"
        assert report.persisted_topic_count == 0
        assert report.persisted_tweet_count == 0
        assert len(report.scraped_topics) == 0
        assert report.error is None


# --- Slice 9: max_topics Boundary Clamping ---


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("input_max", "expected_clamped"),
    [
        (0, 1),
        (-5, 1),
        (100, 10),
        (3, 3),
    ],
)
async def test_slice_9_max_topics_boundary_clamping(
    input_max: int, expected_clamped: int
) -> None:
    """Slice 9: Verify boundary clamping for max_topics (0->1, -5->1, 100->10, 3->3)."""
    mock_topics = [
        {"topic_title": f"Topic {i}", "topic_url": f"https://x.com/search?q={i}"}
        for i in range(15)
    ]
    mock_page = MockPage()

    with (
        patch(
            "app.services.agentic.scraping_graph.extract_grok_summary",
            new_callable=AsyncMock,
            return_value="",
        ),
        patch(
            "app.services.agentic.scraping_graph.extract_topic_tweets",
            new_callable=AsyncMock,
            return_value=[],
        ),
    ):
        state: ScrapingGraphState = {
            "page": mock_page,
            "scraped_topics": mock_topics,
            "max_topics": input_max,
        }
        res = await extract_topic_timelines_node(state)
        assert len(res["topic_tweets_map"]) == expected_clamped


# --- Slice 10: Browser Launch Crash Exception Shielding ---


@pytest.mark.anyio
async def test_slice_10_browser_launch_crash_shielding() -> None:
    """Slice 10: Browser crash or lock error is caught and shielded into error report."""
    user_id = str(uuid.uuid4())

    with patch(
        "app.services.agentic.scraping_graph.BrowserManager"
    ) as MockBrowserManager:
        instance = MockBrowserManager.return_value
        instance.session_exists.return_value = True
        instance.get_context.side_effect = RuntimeError(
            "Google Chrome is currently open with this session or locked"
        )

        report = await scrape_trends_with_graph(user_id=user_id)

        assert isinstance(report, ScrapedBatchReport)
        assert report.status == "error"
        assert report.page_state == "error"
        assert "locked" in str(report.error)
        assert report.persisted_topic_count == 0


# --- Slice 11: Graph Builder Compilation & ScrapedBatchReport Validation ---


def test_slice_11_graph_compilation_and_schema_validation() -> None:
    """Slice 11: Graph builder returns compiled graph and ScrapedBatchReport validates correctly."""
    graph = build_scraping_graph()
    assert graph is not None

    # Test default schema report
    default_report = ScrapedBatchReport()
    assert default_report.status == "persisted"
    assert default_report.page_state == "ok"
    assert default_report.persisted_topic_count == 0
    assert default_report.persisted_tweet_count == 0
    assert default_report.scraped_topics == []
    assert default_report.error is None

    # Test populated schema report
    populated = ScrapedBatchReport(
        scraped_topics=[{"title": "Trend 1"}],
        topic_tweets_map={"url1": [{"text": "hello"}]},
        topic_summaries={"url1": "summary"},
        failed_topics=[{"topic_url": "url2", "reason": "timeout"}],
        persisted_topic_count=1,
        persisted_tweet_count=1,
        page_state="ok",
        session_recovery={"recovered": True},
        status="persisted",
    )
    assert populated.persisted_topic_count == 1
    assert populated.persisted_tweet_count == 1
    assert len(populated.failed_topics) == 1
    assert populated.session_recovery is not None


# --- Node-level and Routing Unit Tests ---


@pytest.mark.anyio
async def test_init_and_recover_session_node_missing_page() -> None:
    """init_and_recover_session_node handles missing page gracefully."""
    with patch(
        "app.services.agentic.scraping_graph.BrowserManager"
    ) as MockBrowserManager:
        instance = MockBrowserManager.return_value
        instance.session_exists.return_value = True

        state: ScrapingGraphState = {"user_id": "test_user", "page": None}
        res = await init_and_recover_session_node(state)
        assert res["status"] == "unrecoverable"
        assert res["page_state"] == "error"


@pytest.mark.anyio
async def test_scrape_explore_trends_node_missing_page() -> None:
    """scrape_explore_trends_node handles missing page gracefully."""
    state: ScrapingGraphState = {"page": None}
    res = await scrape_explore_trends_node(state)
    assert res["status"] == "error"
    assert res["scraped_topics"] == []


@pytest.mark.anyio
async def test_scrape_explore_trends_node_navigation_failure() -> None:
    """scrape_explore_trends_node handles navigation failure."""
    mock_page = MockPage()
    with (
        patch(
            "app.services.agentic.scraping_graph.navigate_to_trends",
            new_callable=AsyncMock,
            return_value=False,
        ),
        patch(
            "app.services.agentic.scraping_graph.detect_page_state",
            new_callable=AsyncMock,
            return_value="rate_limited",
        ),
    ):
        state: ScrapingGraphState = {"page": mock_page}
        res = await scrape_explore_trends_node(state)
        assert res["status"] == "error"
        assert res["page_state"] == "rate_limited"


@pytest.mark.anyio
async def test_persist_scraped_batch_node_empty_topics() -> None:
    """persist_scraped_batch_node handles empty scraped topics list."""
    state: ScrapingGraphState = {"scraped_topics": []}
    res = await persist_scraped_batch_node(state)
    assert res["status"] == "persisted"
    assert res["persisted_topic_count"] == 0
    assert res["persisted_tweet_count"] == 0


@pytest.mark.anyio
async def test_persist_scraped_batch_node_db_error() -> None:
    """persist_scraped_batch_node catches database errors cleanly."""
    state: ScrapingGraphState = {
        "scraped_topics": [
            {"topic_title": "Topic 1", "topic_url": "https://x.com/topic1"}
        ],
        "user_id": str(uuid.uuid4()),
    }
    with (
        patch(
            "app.services.agentic.scraping_graph.resolve_session"
        ) as mock_session_ctx,
        patch(
            "app.services.agentic.scraping_graph.crud.upsert_trending_topic",
            side_effect=RuntimeError("DB connection lost"),
        ),
    ):
        mock_db_session = MagicMock()
        mock_session_ctx.return_value.__enter__.return_value = mock_db_session

        res = await persist_scraped_batch_node(state)
        assert res["status"] == "error"
        assert "DB connection lost" in str(res["error"])


def test_route_after_session_check() -> None:
    """Verify conditional edge routing decisions."""
    assert _route_after_session_check({"page_state": "logged_out"}) == END
    assert _route_after_session_check({"page_state": "captcha"}) == END
    assert _route_after_session_check({"status": "unrecoverable"}) == END
    assert (
        _route_after_session_check({"page_state": "ok", "status": "session_ready"})
        == "scrape_explore_trends"
    )


def test_resolve_user_id_fallback() -> None:
    """Verify user ID resolver handles invalid strings and falls back to UUID."""
    mock_session = MagicMock()
    mock_session.exec.return_value.first.return_value = None

    resolved = _resolve_user_id(user_id="invalid-non-uuid-string", session=mock_session)
    assert isinstance(resolved, uuid.UUID)


def test_load_selectors() -> None:
    """Verify selector loader returns valid dictionary."""
    selectors = _load_selectors()
    assert isinstance(selectors, dict)
    assert "selectors" in selectors or "feed" in selectors
