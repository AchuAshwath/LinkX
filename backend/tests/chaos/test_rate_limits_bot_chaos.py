"""Chaos tests for rate limits and bot challenges (Cloudflare, Arkose, CAPTCHA)."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.browser.diagnostics import detect_page_state
from scripts.scrape_trending_topics import scrape_trending_topics
from tests.helpers.mock_browser import build_mock_locator


class TestRateLimitsAndBotChallenges:
    """Chaos tests attacking rate limit and bot detection state handling."""

    @pytest.mark.anyio
    async def test_detect_page_state_rate_limit_variations(self) -> None:
        """Attack Vector 2A: Validates rate limit text variations."""
        page_rl = AsyncMock(url="https://x.com/home")

        def loc_rl(selector: str) -> Any:
            if selector == "text=Rate limit exceeded":
                return build_mock_locator(count=1)
            return build_mock_locator(count=0)

        page_rl.locator = MagicMock(side_effect=loc_rl)
        state = await detect_page_state(page_rl)
        assert state == "rate_limited"

        page_sww = AsyncMock(url="https://x.com/home")

        def loc_sww(selector: str) -> Any:
            if selector == "text=Something went wrong":
                return build_mock_locator(count=1)
            return build_mock_locator(count=0)

        page_sww.locator = MagicMock(side_effect=loc_sww)
        state = await detect_page_state(page_sww)
        assert state == "rate_limited"

        page_locked = AsyncMock(url="https://x.com/home")

        def loc_locked(selector: str) -> Any:
            if selector == "text=Your account has been locked":
                return build_mock_locator(count=1)
            return build_mock_locator(count=0)

        page_locked.locator = MagicMock(side_effect=loc_locked)
        state_locked = await detect_page_state(page_locked)
        assert state_locked == "rate_limited"

    @pytest.mark.anyio
    async def test_detect_page_state_ignores_hidden_error_banners(self) -> None:
        """Attack Vector 2A-b: Hidden/unrendered error banners in SPA bundle do not trigger rate_limited."""
        page_hidden = AsyncMock(url="https://x.com/home")

        def loc_hidden(selector: str) -> Any:
            if selector == "text=Something went wrong":
                return build_mock_locator(count=1, is_visible=False)
            return build_mock_locator(count=0)

        page_hidden.locator = MagicMock(side_effect=loc_hidden)
        state = await detect_page_state(page_hidden)
        assert state == "ok"

    @pytest.mark.anyio
    async def test_detect_page_state_captcha_sizing_heuristics(self) -> None:
        """Attack Vector 2B: Differentiates tracking iframes vs visible CAPTCHA walls."""
        page_tracking = AsyncMock(url="https://x.com/home")
        mock_tracking_iframe = AsyncMock()
        mock_tracking_iframe.is_visible = AsyncMock(return_value=False)
        mock_tracking_iframe.bounding_box = AsyncMock(return_value=None)

        def loc_tracking(selector: str) -> Any:
            if selector == "iframe[src*='captcha']":
                return build_mock_locator(count=1, all_items=[mock_tracking_iframe])
            return build_mock_locator(count=0)

        page_tracking.locator = MagicMock(side_effect=loc_tracking)
        state_tracking = await detect_page_state(page_tracking)
        assert state_tracking == "ok"

        page_captcha = AsyncMock(url="https://x.com/home")
        mock_captcha_iframe = AsyncMock()
        mock_captcha_iframe.is_visible = AsyncMock(return_value=True)
        mock_captcha_iframe.bounding_box = AsyncMock(
            return_value={"x": 100, "y": 100, "width": 400, "height": 300}
        )

        def loc_captcha(selector: str) -> Any:
            if selector == "iframe[src*='captcha']":
                return build_mock_locator(count=1, all_items=[mock_captcha_iframe])
            return build_mock_locator(count=0)

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
                return build_mock_locator(count=1, all_items=[mock_arkose_iframe])
            return build_mock_locator(count=0)

        page_arkose.locator = MagicMock(side_effect=loc_arkose)
        state_arkose = await detect_page_state(page_arkose)
        assert state_arkose == "captcha"

        page_cf = AsyncMock(url="https://x.com")
        page_cf.title = AsyncMock(return_value="Just a moment...")
        page_cf.locator = MagicMock(return_value=build_mock_locator(count=0))
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
                return build_mock_locator(count=1)
            return build_mock_locator(count=0)

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
