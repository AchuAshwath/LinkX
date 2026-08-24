"""Chaos and adversarial testing suite for browser DOM extraction and selector validation."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.browser.tools import (
    get_dom_snippet,
    validate_selector_candidate,
)
from tests.helpers.mock_browser import build_mock_locator


class TestBloatedAndMaliciousDOMs:
    """Chaos tests attacking the DOM extraction and sanitization toolbelt."""

    @pytest.mark.anyio
    async def test_bloated_dom_5mb_thousands_of_divs(self) -> None:
        single_item = '<div data-testid="tweet_item" role="article"><span name="user">User123</span><a href="/post/1">Post text</a></div>'
        large_dom = f"<html><body><div id='timeline'>{' '.join([single_item] * 5000)}</div></body></html>"

        mock_page = AsyncMock()
        mock_page.evaluate = AsyncMock(return_value=large_dom)

        snippet = await get_dom_snippet(page=mock_page, max_chars=4000)
        assert len(snippet) <= 4000
        assert "timeline" in snippet
        assert "data-testid" in snippet

    @pytest.mark.anyio
    async def test_dom_with_xss_and_non_semantic_tags(self) -> None:
        sanitized_output = (
            '<div id="mainContainer" role="main">'
            '<button data-testid="post_button" aria-label="<script>malicious()</script>">Submit</button>'
            '<input type="text" name="tweet_input" placeholder="Prompt injection"></input>'
            "</div>"
        )
        mock_page = AsyncMock()
        mock_page.evaluate = AsyncMock(return_value=sanitized_output)

        snippet = await get_dom_snippet(page=mock_page, max_chars=5000)
        assert "<style>" not in snippet
        assert "post_button" in snippet
        assert "mainContainer" in snippet

    @pytest.mark.anyio
    async def test_empty_dom_and_null_body(self) -> None:
        mock_page_empty = AsyncMock()
        mock_page_empty.evaluate = AsyncMock(return_value="")
        assert await get_dom_snippet(page=mock_page_empty) == ""

        mock_page_none = AsyncMock()
        mock_page_none.evaluate = AsyncMock(return_value=None)
        assert await get_dom_snippet(page=mock_page_none) == "None"

    @pytest.mark.anyio
    async def test_deeply_nested_dom_recursion_depth_limit(self) -> None:
        mock_page = AsyncMock()
        mock_page.evaluate = AsyncMock(
            return_value="<div><div><div><div><div><div></div></div></div></div></div></div>"
        )

        snippet = await get_dom_snippet(page=mock_page, max_chars=2000)
        assert "<div>" in snippet
        assert len(snippet) <= 2000

    @pytest.mark.anyio
    async def test_dom_snippet_evaluation_exception_recovery(self) -> None:
        mock_page = AsyncMock()
        mock_page.evaluate = AsyncMock(
            side_effect=RuntimeError("Execution context was destroyed.")
        )

        snippet = await get_dom_snippet(page=mock_page)
        assert "<div>Error extracting DOM:" in snippet
        assert "Execution context was destroyed" in snippet


MALFORMED_OR_INJECTION_SELECTORS = [
    "div:broken-pseudo-class",
    "//xpath/invalid[[[unclosed",
    "button:has(>",
    ":::invalid---syntax",
    "[data-testid='unclosed_quote",
    "' OR '1'='1' --",
    "<script>alert(document.cookie)</script>",
    '"; DROP TABLE selectors; --',
    "$(rm -rf /)",
    "A" * 1000,
]


class TestAdversarialCandidateSelectors:
    """Chaos tests evaluating candidate selector verification against adversarial inputs."""

    @pytest.mark.anyio
    async def test_overly_broad_selector_rejection(self) -> None:
        mock_page = AsyncMock()
        mock_body_locator = build_mock_locator(count=1, is_visible=True)
        mock_page.locator = MagicMock(return_value=mock_body_locator)

        result = await validate_selector_candidate(page=mock_page, selector="body")
        assert result["found"] is False
        assert result["visible"] is False
        assert "too generic" in str(result["error"])

    @pytest.mark.anyio
    @pytest.mark.parametrize("bad_sel", MALFORMED_OR_INJECTION_SELECTORS)
    async def test_malformed_and_injection_selectors_fail_gracefully(
        self, bad_sel: str
    ) -> None:
        mock_page = MagicMock()
        mock_page.locator = MagicMock(
            side_effect=Exception(
                f"Playwright error evaluating selector: {bad_sel[:10]}"
            )
        )

        result = await validate_selector_candidate(page=mock_page, selector=bad_sel)
        assert result["found"] is False
        assert result["visible"] is False
        assert result["error"] is not None

    @pytest.mark.anyio
    async def test_candidate_targeting_detached_subtree_element(self) -> None:
        mock_locator = AsyncMock()
        mock_locator.count = AsyncMock(return_value=1)
        mock_locator.first = mock_locator
        mock_locator.is_visible = AsyncMock(
            side_effect=Exception("Target element is not attached to the DOM")
        )

        mock_page = MagicMock()
        mock_page.locator = MagicMock(return_value=mock_locator)

        result = await validate_selector_candidate(
            page=mock_page, selector="div.detached-item"
        )
        assert result["found"] is False
        assert result["visible"] is False
        assert "not attached to the DOM" in str(result["error"])

    @pytest.mark.anyio
    async def test_candidate_targeting_hidden_element(self) -> None:
        mock_hidden_loc = build_mock_locator(count=1, is_visible=False)
        mock_page = MagicMock()
        mock_page.locator = MagicMock(return_value=mock_hidden_loc)

        result = await validate_selector_candidate(
            page=mock_page, selector="div[style*='display: none']"
        )
        assert result["found"] is True
        assert result["visible"] is False


class TestSelectorCandidateValidationVulnerabilities:
    """In-depth tests for edge cases and logic blindspots in validate_selector_candidate."""

    @pytest.mark.anyio
    async def test_validation_all_matching_elements_hidden(self) -> None:
        mock_locator = build_mock_locator(count=5, is_visible=False)
        mock_page = MagicMock()
        mock_page.locator = MagicMock(return_value=mock_locator)

        result = await validate_selector_candidate(
            page=mock_page, selector="input[type='hidden']"
        )
        assert result["found"] is True
        assert result["visible"] is False
        assert result["count"] == 5

    @pytest.mark.anyio
    async def test_validation_first_hidden_second_visible(self) -> None:
        mock_elem_0 = AsyncMock()
        mock_elem_0.is_visible = AsyncMock(return_value=False)
        mock_elem_1 = AsyncMock()
        mock_elem_1.is_visible = AsyncMock(return_value=True)

        mock_locator = MagicMock()
        mock_locator.count = AsyncMock(return_value=2)
        mock_locator.first = mock_elem_0
        mock_locator.nth = MagicMock(
            side_effect=lambda i: mock_elem_1 if i == 1 else mock_elem_0
        )

        mock_page = MagicMock()
        mock_page.locator = MagicMock(return_value=mock_locator)

        result = await validate_selector_candidate(
            page=mock_page, selector="button.compose-btn"
        )
        assert result["found"] is True
        assert result["visible"] is True
        assert result["count"] == 2

    @pytest.mark.anyio
    async def test_validation_timeout_resilience(self) -> None:
        mock_locator = AsyncMock()
        mock_locator.count = AsyncMock(return_value=1)
        mock_locator.first = mock_locator
        mock_locator.is_visible = AsyncMock(
            side_effect=TimeoutError("Playwright locator timed out")
        )

        mock_page = MagicMock()
        mock_page.locator = MagicMock(return_value=mock_locator)

        result = await validate_selector_candidate(
            page=mock_page, selector="div.slow", timeout_ms=500
        )
        assert result["found"] is False
        assert result["visible"] is False
        assert "timed out" in str(result["error"])
