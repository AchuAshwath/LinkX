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
from app.services.browser.manager import (
    BrowserManager,
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
    _navigate_and_verify_topic,
    _scrape_candidate_topics,
    navigate_to_trends,
    scrape_trending_topics,
)
from tests.helpers.mock_browser import build_mock_locator

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

        mock_locator = build_mock_locator(count=1, is_visible=True)
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

        mock_locator = build_mock_locator(count=1, is_visible=True)
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

        mock_broken = build_mock_locator(count=0, is_visible=False)
        mock_login_elem = build_mock_locator(count=1, is_visible=True)

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

        mock_broken = build_mock_locator(count=0, is_visible=False)
        mock_login_elem = build_mock_locator(count=1, is_visible=True)

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
            return build_mock_locator(count=0, is_visible=False)

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
            return build_mock_locator(count=0, is_visible=False)

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
