"""Chaos and adversarial testing suite for browser session, page state, and network resilience.

Attack vectors tested:
1. Mid-Scrape Session Invalidation:
   - Session expiration / redirect to /login or /i/flow/login during topic scrape.
   - Self-healing guardrails vs hazards: aborting when page_state is logged_out vs LLM hallucinating authenticated.
   - navigate_to_trends pre-navigation vs post-navigation session verification blindspot.
   - BrowserManager.verify_session handling of expired / invalid cookies.
   - scrape_trending_topics clean abort on initial logged_out page state.
   - Loop continuation vulnerability: _scrape_candidate_topics continuing after session loss.

2. Rate Limiting & Bot Challenges (Cloudflare / Arkose / CAPTCHA):
   - detect_page_state detection of rate limits ("Rate limit exceeded", "Something went wrong", account lock).
   - CAPTCHA detection sizing heuristics and Cloudflare/Arkose challenge blindspots.
   - Mid-scrape rate limit encounter during topic verification.
   - Self-healing guardrails on rate-limited / challenge pages.
   - Scraper clean exit on home feed rate limit.

3. Infinite Scroll & Zombie Locators:
   - Empty timeline (shadow-banned / 0 tweets) bounded termination.
   - Infinite duplicate tweets / stuck timeline deduplication & author saturation capping.
   - Zombie locators & DOM detachment (PlaywrightError) handling during tweet extraction.
   - extract_topic_tweets robustness against malformed DOM or evaluate outputs.

4. Browser Crash & Target Closed Mid-Action:
   - Page/Browser crash (TargetClosedError) during find_or_heal_element.
   - EvasionMouse idle background loop resilience to target closed.
   - EvasionMouse human_click/type lock release on crash.
   - scrape_trending_topics clean abort status on TargetClosedError.
   - BrowserManager launch lock / session directory error handling.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from rebrowser_playwright.async_api import Error as PlaywrightError

from app.services.agentic.schemas import (
    SelectorCandidate,
    SelectorDiagnosisReport,
)
from app.services.browser.actions import EvasionMouse, PostButtonDisabledError
from app.services.browser.diagnostics import detect_page_state
from app.services.browser.manager import (
    BrowserManager,
    _clean_stale_singleton_locks,
    _handle_launch_error,
)
from app.services.browser.tools import (
    SelectorHealingError,
    find_or_heal_element,
)
from scripts.scrape_trending_topics import (
    CandidateScrapeContext,
    ScrapeResult,
    TopicFailure,
    TopicProcessContext,
    _expand_tweet,
    _navigate_and_verify_topic,
    _scrape_candidate_topics,
    _scrape_topic_tweets,
    extract_topic_tweets,
    extract_tweet_data,
    navigate_to_trends,
    scrape_trending_topics,
)


def _build_mock_locator(
    *,
    count: int = 0,
    is_visible: bool = False,
    inner_text: str = "",
    attribute_val: str | None = None,
    all_items: list[Any] | None = None,
) -> MagicMock:
    """Helper to construct Playwright-like async locators."""
    loc = MagicMock()
    loc.count = AsyncMock(return_value=count)
    loc.is_visible = AsyncMock(return_value=is_visible)
    loc.inner_text = AsyncMock(return_value=inner_text)
    loc.get_attribute = AsyncMock(return_value=attribute_val)
    loc.first = loc
    loc.nth = MagicMock(return_value=loc)
    loc.all = AsyncMock(return_value=all_items or [])
    loc.filter = MagicMock(return_value=loc)
    loc.click = AsyncMock()
    loc.evaluate = AsyncMock()
    return loc


def _build_mock_tweet(text: str, raw: str) -> MagicMock:
    """Helper to construct a tweet article locator with proper sub-locators."""
    tweet = MagicMock()
    tweet_text_loc = _build_mock_locator(count=1, inner_text=text)
    show_more_loc = _build_mock_locator(count=0)
    generic_empty = _build_mock_locator(count=0)

    def loc_fn(selector: str) -> Any:
        if "tweet-text-show-more-link" in selector:
            return show_more_loc
        if "tweetText" in selector:
            return tweet_text_loc
        return generic_empty

    tweet.locator = MagicMock(side_effect=loc_fn)
    tweet.inner_text = AsyncMock(return_value=raw)
    tweet.page = AsyncMock()
    return tweet


# ==============================================================================
# 1. MID-SCRAPE SESSION INVALIDATION TESTS
# ==============================================================================


class TestMidScrapeSessionInvalidation:
    """Chaos tests probing session expiration and redirect behaviors mid-operation."""

    @pytest.mark.anyio
    async def test_topic_navigation_redirect_to_login_detected_as_failure(self) -> None:
        """Attack Vector 1A: Mid-scrape navigation to a topic redirects to /login."""
        mock_page = AsyncMock()
        mock_page.url = "https://x.com/i/flow/login"

        mock_locator = _build_mock_locator(count=1, is_visible=True)
        mock_page.locator = MagicMock(return_value=mock_locator)

        # wait_for_selector times out waiting for tweets on the login page
        mock_page.wait_for_selector = AsyncMock(
            side_effect=PlaywrightError("Timeout 15000ms exceeded waiting for selector")
        )

        mock_mouse = AsyncMock()
        mock_mouse.human_click = AsyncMock()

        ctx = TopicProcessContext(
            page=mock_page,
            mouse=mock_mouse,
            target_id="/search?q=BreakingNews",
            target_title="Breaking News",
            is_href=True,
            db_user_id=None,
            config={},
        )

        ok, failure = await _navigate_and_verify_topic(ctx, "[data-testid='tweet']")

        assert ok is False
        assert failure is not None
        assert failure.reason == "timeout"
        assert "Timed out waiting for tweets" in failure.detail

    @pytest.mark.anyio
    async def test_topic_navigation_page_state_error_on_logged_out(self) -> None:
        """Attack Vector 1B: If wait_for_selector succeeds unexpectedly on /login, detect_page_state flags logged_out."""
        mock_page = AsyncMock()
        mock_page.url = "https://x.com/login"

        mock_locator = _build_mock_locator(count=1, is_visible=True)
        mock_page.locator = MagicMock(return_value=mock_locator)
        mock_page.wait_for_selector = AsyncMock()

        mock_mouse = AsyncMock()
        mock_mouse.human_click = AsyncMock()

        ctx = TopicProcessContext(
            page=mock_page,
            mouse=mock_mouse,
            target_id="/search?q=Topic1",
            target_title="Topic 1",
            is_href=True,
            db_user_id=None,
            config={},
        )

        ok, failure = await _navigate_and_verify_topic(ctx, "[data-testid='tweet']")

        assert ok is False
        assert failure is not None
        assert failure.reason == "page_state_error"
        assert "logged_out" in failure.detail

    @pytest.mark.anyio
    async def test_self_healing_aborts_when_page_state_is_logged_out(
        self, tmp_path: Path
    ) -> None:
        """Attack Vector 1C: When page is logged out, self-healing supervisor aborts without mutating config."""
        config_file = tmp_path / "scrape_config.json"
        initial_config = {
            "selectors": {"sidebar_container": "[data-testid='sidebarColumn']"}
        }
        config_file.write_text(json.dumps(initial_config))

        mock_page = AsyncMock()
        mock_page.url = "https://x.com/i/flow/login"
        mock_page.evaluate = AsyncMock(
            return_value='<div role="main" data-testid="loginForm"><input name="username"/><button>Log in</button></div>'
        )

        mock_broken = _build_mock_locator(count=0, is_visible=False)
        mock_login_elem = _build_mock_locator(count=1, is_visible=True)

        def locator_side_effect(sel: str) -> Any:
            if sel == "div[data-testid='loginForm']":
                return mock_login_elem
            return mock_broken

        mock_page.locator = MagicMock(side_effect=locator_side_effect)

        selectors_dict = {
            "selectors": {"sidebar_container": "[data-testid='sidebarColumn']"}
        }

        # LLM reports logged_out
        mock_diagnosis = SelectorDiagnosisReport(
            broken_element_name="selectors.sidebar_container",
            page_state="logged_out",
            is_recoverable=False,
            candidate_selectors=[],
        )
        mock_structured_model = AsyncMock(
            ainvoke=AsyncMock(return_value=mock_diagnosis)
        )

        with patch(
            "app.services.agentic.self_healing_graph.get_chat_model"
        ) as mock_get_model:
            mock_model = MagicMock(
                with_structured_output=MagicMock(return_value=mock_structured_model)
            )
            mock_get_model.return_value = mock_model

            with pytest.raises(SelectorHealingError) as exc_info:
                await find_or_heal_element(
                    page=mock_page,
                    selector_key="selectors.sidebar_container",
                    selectors_dict=selectors_dict,
                    config_path=config_file,
                )

            assert "selectors.sidebar_container" in str(exc_info.value)
            # Config file is NOT modified
            assert (
                json.loads(config_file.read_text())["selectors"]["sidebar_container"]
                == "[data-testid='sidebarColumn']"
            )

    @pytest.mark.anyio
    async def test_session_invalidation_hazard_llm_hallucination_on_login_page(
        self, tmp_path: Path
    ) -> None:
        """Attack Vector 1D (Vulnerability Hazard): When LLM hallucinates authenticated on login page.

        Demonstrates that if the LLM falsely claims page_state is authenticated,
        self-healing will match the login form.
        """
        config_file = tmp_path / "scrape_config.json"
        initial_config = {
            "selectors": {"sidebar_container": "[data-testid='sidebarColumn']"}
        }
        config_file.write_text(json.dumps(initial_config))

        mock_page = AsyncMock()
        mock_page.url = "https://x.com/i/flow/login"
        mock_page.evaluate = AsyncMock(
            return_value='<div role="main" data-testid="loginForm"><input name="username"/><button>Log in</button></div>'
        )

        mock_broken = _build_mock_locator(count=0, is_visible=False)
        mock_login_elem = _build_mock_locator(count=1, is_visible=True)

        def locator_side_effect(sel: str) -> Any:
            if sel == "div[data-testid='loginForm']":
                return mock_login_elem
            return mock_broken

        mock_page.locator = MagicMock(side_effect=locator_side_effect)

        selectors_dict = {
            "selectors": {"sidebar_container": "[data-testid='sidebarColumn']"}
        }

        # LLM hallucinating authenticated status on a login page
        mock_diagnosis = SelectorDiagnosisReport(
            broken_element_name="selectors.sidebar_container",
            page_state="authenticated",
            is_recoverable=True,
            candidate_selectors=[
                SelectorCandidate(
                    selector="div[data-testid='loginForm']",
                    confidence=0.85,
                    reasoning="Found main container on current page",
                )
            ],
        )
        mock_structured_model = AsyncMock(
            ainvoke=AsyncMock(return_value=mock_diagnosis)
        )

        with patch(
            "app.services.agentic.self_healing_graph.get_chat_model"
        ) as mock_get_model:
            mock_model = MagicMock(
                with_structured_output=MagicMock(return_value=mock_structured_model)
            )
            mock_get_model.return_value = mock_model

            elem = await find_or_heal_element(
                page=mock_page,
                selector_key="selectors.sidebar_container",
                selectors_dict=selectors_dict,
                config_path=config_file,
            )

            assert elem is not None
            assert (
                selectors_dict["selectors"]["sidebar_container"]
                == "div[data-testid='loginForm']"
            )

    @pytest.mark.anyio
    async def test_navigate_to_trends_post_navigation_redirect_hazard(self) -> None:
        """Attack Vector 1E: navigate_to_trends checks auth after goto, catching redirects to /login."""
        mock_page = AsyncMock()
        mock_page.url = "https://x.com/home"

        def loc_fn(_sel: str) -> Any:
            return _build_mock_locator(count=0, is_visible=False)

        mock_page.locator = MagicMock(side_effect=loc_fn)

        async def fake_goto(_url: str, **_kwargs: Any) -> None:
            # Server redirects browser to /login during goto
            mock_page.url = "https://x.com/login"

        mock_page.goto = AsyncMock(side_effect=fake_goto)

        # Calling navigate_to_trends
        nav_result = await navigate_to_trends(
            mock_page, target_url="https://x.com/home"
        )

        # Correctly returns False because post-navigation page state is logged_out
        assert nav_result is False
        assert "/login" in mock_page.url

    @pytest.mark.anyio
    async def test_scrape_trending_topics_initial_auth_failure_abort(self) -> None:
        """Attack Vector 1F: scrape_trending_topics detects logged_out immediately on launch."""
        mock_page = AsyncMock()
        mock_page.url = "https://x.com/login"
        mock_page.goto = AsyncMock()

        def loc_fn(_sel: str) -> Any:
            return _build_mock_locator(count=0, is_visible=False)

        mock_page.locator = MagicMock(side_effect=loc_fn)

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

            assert result.status == "auth_failed"
            assert result.topics_found == 0
            assert result.topics_scraped == 0

    @pytest.mark.anyio
    async def test_browser_manager_verify_session_redirected_to_login(
        self, tmp_path: Path
    ) -> None:
        """Attack Vector 1G: Session folder exists on disk, but live navigation fails auth."""
        bm = BrowserManager(user_id="chaos_user")
        session_dir = tmp_path / "x"
        cookies_dir = session_dir / "Default"
        cookies_dir.mkdir(parents=True)
        (cookies_dir / "Cookies").write_bytes(b"dummy_cookie_payload")

        mock_page = AsyncMock()
        mock_page.url = "https://x.com/login"
        mock_page.goto = AsyncMock()
        mock_page.query_selector = AsyncMock(return_value=None)  # Sentinel not found

        mock_context = AsyncMock()
        mock_context.pages = [mock_page]

        with (
            patch.object(bm, "get_session_dir_path", return_value=session_dir),
            patch.object(
                bm,
                "get_context",
                return_value=AsyncMock(
                    __aenter__=AsyncMock(return_value=mock_context),
                    __aexit__=AsyncMock(return_value=None),
                ),
            ),
        ):
            resp = await bm.verify_session("x")

            assert resp["connected"] is True
            assert resp["authenticated"] is False
            assert "expired or login required" in resp["message"]

    @pytest.mark.anyio
    async def test_mid_scrape_candidate_topics_loop_continuation_vulnerability(
        self,
    ) -> None:
        """Attack Vector 1H: Fast-aborts topic loop immediately upon unrecoverable session loss."""
        mock_page = AsyncMock()
        mock_mouse = AsyncMock()

        call_count = 0

        async def fake_process_single_topic(
            ctx: Any,
        ) -> tuple[bool, TopicFailure | None]:
            nonlocal call_count
            call_count += 1
            # Fails with page_state_error (logged_out)
            return False, TopicFailure(
                topic_id=ctx.target_id,
                reason="page_state_error",
                detail="Page state: logged_out",
            )

        news_urls = [
            ("/search?q=Topic1", True),
            ("/search?q=Topic2", True),
            ("/search?q=Topic3", True),
        ]
        news_titles = {
            "/search?q=Topic1": "Topic 1",
            "/search?q=Topic2": "Topic 2",
            "/search?q=Topic3": "Topic 3",
        }

        result = ScrapeResult(status="pending")
        candidate_ctx = CandidateScrapeContext(
            page=mock_page,
            mouse=mock_mouse,
            news_urls=news_urls,
            news_titles=news_titles,
            db_user_id=None,
            config={},
            max_topics=3,
            result=result,
        )

        with patch(
            "scripts.scrape_trending_topics._process_single_topic",
            side_effect=fake_process_single_topic,
        ):
            await _scrape_candidate_topics(candidate_ctx)

            # Verified: loop fast-aborts on first logged_out failure instead of continuing
            assert call_count == 1
            assert len(result.topics_failed) == 1
            assert result.topics_scraped == 0


# ==============================================================================
# 2. RATE LIMIT & BOT CHALLENGES (CAPTCHA / CLOUDFLARE / ARKOSE) TESTS
# ==============================================================================


class TestRateLimitsAndBotChallenges:
    """Chaos tests attacking rate limit and bot detection state handling."""

    @pytest.mark.anyio
    async def test_detect_page_state_rate_limit_variations(self) -> None:
        """Attack Vector 2A: Validates rate limit text variations."""
        # 1. Rate limit exceeded banner
        page_rl = AsyncMock(url="https://x.com/home")

        def loc_rl(selector: str) -> Any:
            if selector == "text=Rate limit exceeded":
                return _build_mock_locator(count=1)
            return _build_mock_locator(count=0)

        page_rl.locator = MagicMock(side_effect=loc_rl)
        state = await detect_page_state(page_rl)
        assert state == "rate_limited"

        # 2. Something went wrong banner
        page_sww = AsyncMock(url="https://x.com/home")

        def loc_sww(selector: str) -> Any:
            if selector == "text=Something went wrong":
                return _build_mock_locator(count=1)
            return _build_mock_locator(count=0)

        page_sww.locator = MagicMock(side_effect=loc_sww)
        state = await detect_page_state(page_sww)
        assert state == "rate_limited"

        # 3. Account locked banner
        page_locked = AsyncMock(url="https://x.com/home")

        def loc_locked(selector: str) -> Any:
            if selector == "text=Your account has been locked":
                return _build_mock_locator(count=1)
            return _build_mock_locator(count=0)

        page_locked.locator = MagicMock(side_effect=loc_locked)
        state_locked = await detect_page_state(page_locked)
        assert state_locked == "rate_limited"

    @pytest.mark.anyio
    async def test_detect_page_state_captcha_sizing_heuristics(self) -> None:
        """Attack Vector 2B: Differentiates tracking iframes vs visible CAPTCHA walls."""
        # 1. Hidden / zero-size tracking iframe -> returns 'ok'
        page_tracking = AsyncMock(url="https://x.com/home")
        mock_tracking_iframe = AsyncMock()
        mock_tracking_iframe.is_visible = AsyncMock(return_value=False)
        mock_tracking_iframe.bounding_box = AsyncMock(return_value=None)

        def loc_tracking(selector: str) -> Any:
            if selector == "iframe[src*='captcha']":
                return _build_mock_locator(count=1, all_items=[mock_tracking_iframe])
            return _build_mock_locator(count=0)

        page_tracking.locator = MagicMock(side_effect=loc_tracking)
        state_tracking = await detect_page_state(page_tracking)
        assert state_tracking == "ok"

        # 2. Large visible CAPTCHA modal (> 100x100) -> returns 'captcha'
        page_captcha = AsyncMock(url="https://x.com/home")
        mock_captcha_iframe = AsyncMock()
        mock_captcha_iframe.is_visible = AsyncMock(return_value=True)
        mock_captcha_iframe.bounding_box = AsyncMock(
            return_value={"x": 100, "y": 100, "width": 400, "height": 300}
        )

        def loc_captcha(selector: str) -> Any:
            if selector == "iframe[src*='captcha']":
                return _build_mock_locator(count=1, all_items=[mock_captcha_iframe])
            return _build_mock_locator(count=0)

        page_captcha.locator = MagicMock(side_effect=loc_captcha)
        state_captcha = await detect_page_state(page_captcha)
        assert state_captcha == "captcha"

    @pytest.mark.anyio
    async def test_detect_page_state_arkose_and_cloudflare_blindspots(self) -> None:
        """Attack Vector 2C: Arkose Labs & Cloudflare challenge detection."""
        page_arkose = AsyncMock(url="https://x.com/account/access")
        page_arkose.title = AsyncMock(return_value="Twitter / Arkose Challenge")

        mock_arkose_iframe = AsyncMock()
        mock_arkose_iframe.is_visible = AsyncMock(return_value=True)
        mock_arkose_iframe.bounding_box = AsyncMock(
            return_value={"x": 50, "y": 50, "width": 350, "height": 400}
        )

        def loc_arkose(selector: str) -> Any:
            if "arkose" in selector or "arkoselabs" in selector:
                return _build_mock_locator(count=1, all_items=[mock_arkose_iframe])
            return _build_mock_locator(count=0)

        page_arkose.locator = MagicMock(side_effect=loc_arkose)
        state_arkose = await detect_page_state(page_arkose)

        # Verified: Arkose challenge is detected as 'captcha'
        assert state_arkose == "captcha"

        # Also test Cloudflare Turnstile title check
        page_cf = AsyncMock(url="https://x.com")
        page_cf.title = AsyncMock(return_value="Just a moment...")
        page_cf.locator = MagicMock(return_value=_build_mock_locator(count=0))
        state_cf = await detect_page_state(page_cf)
        assert state_cf == "captcha"

    @pytest.mark.anyio
    async def test_scrape_trending_topics_rate_limited_clean_exit(self) -> None:
        """Attack Vector 2D: scrape_trending_topics cleanly aborts when home feed is rate limited."""
        mock_page = AsyncMock()
        mock_page.url = "https://x.com/home"
        mock_page.goto = AsyncMock()

        def loc_fn(selector: str) -> Any:
            if selector == "text=Rate limit exceeded":
                return _build_mock_locator(count=1)
            return _build_mock_locator(count=0)

        mock_page.locator = MagicMock(side_effect=loc_fn)

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

            assert result.status == "rate_limited"
            assert result.topics_found == 0
            assert result.topics_scraped == 0


# ==============================================================================
# 3. INFINITE SCROLL & ZOMBIE LOCATORS TESTS
# ==============================================================================


class TestInfiniteScrollAndZombieLocators:
    """Chaos tests attacking timeline scrolling, empty feeds, and detached DOM nodes."""

    @pytest.mark.anyio
    async def test_empty_timeline_infinite_scroll_bounded_termination(self) -> None:
        """Attack Vector 3A: Empty search/topic page returns 0 tweets; terminates in bounded scrolls."""
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
            # Verifies exact bounded scroll count (3 scrolls executed)
            assert mock_mouse.human_scroll.await_count == 3

    @pytest.mark.anyio
    async def test_stuck_timeline_duplicate_tweets_and_author_saturation(self) -> None:
        """Attack Vector 3B: Page returns duplicate tweets from the same author; deduplicates & caps."""
        t1 = _build_mock_tweet(
            text="Spam tweet 1",
            raw="@spammer\nSpam tweet 1\n10\n20\n30\n40",
        )
        t2 = _build_mock_tweet(
            text="Spam tweet 2",
            raw="@spammer\nSpam tweet 2\n10\n20\n30\n40",
        )
        t3 = _build_mock_tweet(
            text="Spam tweet 3",
            raw="@spammer\nSpam tweet 3\n10\n20\n30\n40",
        )
        t4 = _build_mock_tweet(
            text="Legitimate tweet",
            raw="@legit_user\nLegitimate tweet\n10\n20\n30\n40",
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

            # Only 3 tweets accepted: 2 from @spammer (cap reached) + 1 from @legit_user
            assert len(conversations) == 3
            authors = [c["author"] for c in conversations]
            assert authors.count("@spammer") == 2
            assert authors.count("@legit_user") == 1

    @pytest.mark.anyio
    async def test_zombie_locator_dom_detachment_during_tweet_extraction(self) -> None:
        """Attack Vector 3C: Locator detaches from DOM mid-iteration; extract_tweet_data returns None cleanly."""
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

        # Test _expand_tweet handles PlaywrightError
        await _expand_tweet(mock_detached_locator)

        # Test extract_tweet_data catches PlaywrightError and returns None
        data = await extract_tweet_data(mock_detached_locator)
        assert data is None

    @pytest.mark.anyio
    async def test_extract_topic_tweets_malformed_evaluate_resilience(self) -> None:
        """Attack Vector 3D: extract_topic_tweets handles null, string, or malformed list evaluation."""
        mock_page = AsyncMock()
        mock_page.url = "https://x.com/search?q=Test"

        # 1. Evaluate returns None
        mock_page.evaluate = AsyncMock(return_value=None)
        tweets_none = await extract_topic_tweets(
            page=mock_page,
            topic_url="https://x.com/search?q=Test",
            selectors={"selectors": {"tweet_container": "[data-testid='tweet']"}},
        )
        assert tweets_none == []

        # 2. Evaluate returns malformed list items missing fields
        mock_page.evaluate = AsyncMock(
            return_value=[
                {"author_handle": "@test"},  # missing text
                {"text": "just text"},  # missing author
                {},  # completely empty dict
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


# ==============================================================================
# 4. BROWSER CRASH & TARGET CLOSED MID-ACTION TESTS
# ==============================================================================


class TestBrowserCrashAndTargetClosed:
    """Chaos tests probing process termination, crashed targets, and unhandled task crashes."""

    @pytest.mark.anyio
    async def test_page_crash_target_closed_during_find_or_heal_element(
        self, tmp_path: Path
    ) -> None:
        """Attack Vector 4A: Browser context crashes mid-operation in find_or_heal_element."""
        config_file = tmp_path / "scrape_config.json"
        config_file.write_text('{"compose": {"post_input": "button#submit"}}')

        mock_page = AsyncMock()
        mock_page.url = "https://x.com/home"

        # When locator or evaluate is called on a crashed page, Playwright throws Target closed
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

        # Self healing attempts to run, but candidate verification also throws on dead page
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
        """Attack Vector 4B: EvasionMouse idle background loop terminates cleanly when page closes."""
        mock_page = AsyncMock()
        mock_page.viewport_size = {"width": 1280, "height": 800}

        # mouse.move raises Target Closed
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
            # Yield control to let idle loop execute, attempt move, catch exception and stop
            await asyncio.sleep(0.05)

        # Idling should be cleanly stopped by the exception handler in _idle_loop
        assert mouse._is_idling is False
        assert mouse._idle_task is None or mouse._idle_task.done()
        await mouse.stop_idle()

    @pytest.mark.anyio
    async def test_evasion_mouse_human_click_lock_release_on_timeout(self) -> None:
        """Attack Vector 4C: human_click releases its lock and restarts idle on PostButtonDisabledError."""
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

        # Lock MUST be unlocked so subsequent actions are not deadlocked
        assert not mouse.lock.locked()
        # Idle task should have resumed
        assert mouse._is_idling is True
        await mouse.stop_idle()

    @pytest.mark.anyio
    async def test_scrape_trending_topics_target_closed_aborted_status(self) -> None:
        """Attack Vector 4D: scrape_trending_topics marks status as 'aborted' when target closes."""
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
        """Attack Vector 4E: BrowserManager cleans stale singleton locks and translates launch errors."""
        session_dir = tmp_path / "x_session"
        session_dir.mkdir(parents=True)
        lock_file = session_dir / "SingletonLock"
        lock_file.write_text("lock_content")

        with patch(
            "app.services.browser.manager.is_chrome_running", return_value=False
        ):
            _clean_stale_singleton_locks(session_dir)
            # Stale lock should have been unlinked
            assert not lock_file.exists()

        # Test Chrome launch error translation
        with pytest.raises(RuntimeError) as exc_info:
            _handle_launch_error(
                Exception(
                    "ProcessSingleton: The profile appears to be in use by another Google Chrome process"
                )
            )
        assert "Google Chrome is currently open" in str(exc_info.value)
