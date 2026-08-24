"""Chaos and adversarial testing suite for browser DOM extraction, selector validation, and self-healing."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.agentic.schemas import SelectorCandidate, SelectorDiagnosisReport
from app.services.agentic.self_healing_graph import (
    SelfHealingState,
    capture_dom_node,
    diagnose_dom_node,
    heal_selector,
    verify_candidates_node,
)
from app.services.browser.tools import (
    SelectorHealingError,
    find_or_heal_element,
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

        snippet_empty = await get_dom_snippet(page=mock_page_empty)
        assert snippet_empty == ""

        state: SelfHealingState = {"page": mock_page_empty}
        captured = await capture_dom_node(state)
        assert captured["dom_snippet"] == ""
        assert captured["status"] == "dom_captured"

        mock_structured_model = AsyncMock()
        mock_structured_model.ainvoke = AsyncMock(
            return_value=SelectorDiagnosisReport(
                broken_element_name="compose.post_input",
                page_state="login_redirect",
                is_recoverable=False,
                candidate_selectors=[],
            )
        )
        with patch(
            "app.services.agentic.self_healing_graph.get_chat_model"
        ) as mock_get_model:
            mock_model = MagicMock()
            mock_model.with_structured_output = MagicMock(
                return_value=mock_structured_model
            )
            mock_get_model.return_value = mock_model

            diag_res = await diagnose_dom_node(
                {"dom_snippet": "", "failed_selector_key": "compose.post_input"}
            )
            assert diag_res["status"] == "diagnosed"

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

        state: SelfHealingState = {"page": mock_page}
        result = await capture_dom_node(state)
        assert "Error extracting DOM" in (result.get("dom_snippet") or "")
        assert result["status"] == "dom_captured"


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
    async def test_overly_broad_selector_rejection(self, tmp_path: Path) -> None:
        mock_page = AsyncMock()
        mock_body_locator = build_mock_locator(count=1, is_visible=True)
        mock_page.locator = MagicMock(return_value=mock_body_locator)

        result = await validate_selector_candidate(page=mock_page, selector="body")
        assert result["found"] is False
        assert result["visible"] is False
        assert "too generic" in str(result["error"])

        state: SelfHealingState = {
            "page": mock_page,
            "diagnosis": SelectorDiagnosisReport(
                broken_element_name="compose.post_button",
                page_state="authenticated",
                is_recoverable=True,
                candidate_selectors=[
                    SelectorCandidate(
                        selector="body", confidence=0.99, reasoning="Matches body"
                    ),
                ],
            ),
        }
        verify_result = await verify_candidates_node(state)
        assert verify_result["working_selector"] is None
        assert verify_result["status"] == "all_candidates_failed"

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

        state: SelfHealingState = {
            "page": mock_page,
            "diagnosis": SelectorDiagnosisReport(
                broken_element_name="compose.post_button",
                page_state="authenticated",
                is_recoverable=True,
                candidate_selectors=[
                    SelectorCandidate(
                        selector="div[style*='display: none']",
                        confidence=0.9,
                        reasoning="Hidden",
                    )
                ],
            ),
        }
        res = await verify_candidates_node(state)
        assert res["working_selector"] is None
        assert res["status"] == "all_candidates_failed"


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


def _build_adversarial_diagnosis() -> SelectorDiagnosisReport:
    """Build adversarial candidate diagnosis with invalid pseudo, detached, and hidden selectors."""
    return SelectorDiagnosisReport(
        broken_element_name="compose.post_input",
        page_state="authenticated",
        is_recoverable=True,
        candidate_selectors=[
            SelectorCandidate(
                selector="div[[[malformed---pseudo",
                confidence=0.99,
                reasoning="Hallucinated",
            ),
            SelectorCandidate(
                selector="div.detached", confidence=0.95, reasoning="Detached"
            ),
            SelectorCandidate(
                selector="div.hidden-input", confidence=0.90, reasoning="Hidden"
            ),
            SelectorCandidate(
                selector="div[data-testid='tweetTextarea_0']",
                confidence=0.85,
                reasoning="Valid match",
            ),
        ],
    )


def _build_adversarial_page() -> AsyncMock:
    """Build mock page with dispatching locators simulating various DOM failure modes."""
    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(
        return_value="<div data-testid='tweetTextarea_0'>Valid Textarea</div>"
    )
    mock_valid_loc = build_mock_locator(count=1, is_visible=True)
    mock_hidden_loc = build_mock_locator(count=1, is_visible=False)

    def locator_dispatch(sel: str) -> Any:
        if sel == "div[[[malformed---pseudo":
            raise Exception("DOMException: Invalid selector")
        if sel == "div.detached":
            loc = MagicMock()
            loc.count = AsyncMock(return_value=1)
            loc.first = loc
            loc.nth = MagicMock(return_value=loc)
            loc.is_visible = AsyncMock(
                side_effect=Exception("Element detached from DOM")
            )
            return loc
        if sel == "div.hidden-input":
            return mock_hidden_loc
        if sel == "div[data-testid='tweetTextarea_0']":
            return mock_valid_loc
        return build_mock_locator(count=0, is_visible=False)

    mock_page.locator = MagicMock(side_effect=locator_dispatch)
    return mock_page


class TestSelfHealingSupervisorChaos:
    """End-to-end chaos tests for StateGraph supervisor and configuration persistence."""

    @pytest.mark.anyio
    async def test_supervisor_mixed_adversarial_candidate_stream_recovers_to_valid(
        self, tmp_path: Path
    ) -> None:
        config_file = tmp_path / "selectors.json"
        config_file.write_text('{"compose": {"post_input": "broken_old"}}')

        mock_page = _build_adversarial_page()
        diagnosis = _build_adversarial_diagnosis()
        mock_structured_model = AsyncMock(ainvoke=AsyncMock(return_value=diagnosis))

        with patch(
            "app.services.agentic.self_healing_graph.get_chat_model"
        ) as mock_get_model:
            mock_model = MagicMock()
            mock_model.with_structured_output = MagicMock(
                return_value=mock_structured_model
            )
            mock_get_model.return_value = mock_model

            healed_selector = await heal_selector(
                page=mock_page,
                failed_selector_key="compose.post_input",
                config_path=config_file,
            )

            assert healed_selector == "div[data-testid='tweetTextarea_0']"
            with open(config_file) as f:
                saved = json.load(f)
            assert (
                saved["compose"]["post_input"] == "div[data-testid='tweetTextarea_0']"
            )

    @pytest.mark.anyio
    async def test_supervisor_empty_unrecoverable_diagnosis_raises_error(
        self, tmp_path: Path
    ) -> None:
        config_file = tmp_path / "selectors.json"
        initial_content = {"compose": {"post_input": "broken_old"}}
        config_file.write_text(json.dumps(initial_content))

        mock_page = AsyncMock()
        mock_page.evaluate = AsyncMock(return_value="<div>Login Form</div>")
        mock_page.locator = MagicMock(
            return_value=build_mock_locator(count=0, is_visible=False)
        )

        diagnosis = SelectorDiagnosisReport(
            broken_element_name="compose.post_input",
            page_state="login_redirect",
            is_recoverable=False,
            candidate_selectors=[],
            reasoning="Page redirected to login; cannot heal.",
        )
        mock_structured_model = AsyncMock(ainvoke=AsyncMock(return_value=diagnosis))

        with patch(
            "app.services.agentic.self_healing_graph.get_chat_model"
        ) as mock_get_model:
            mock_model = MagicMock()
            mock_model.with_structured_output = MagicMock(
                return_value=mock_structured_model
            )
            mock_get_model.return_value = mock_model

            with pytest.raises(SelectorHealingError) as exc_info:
                await find_or_heal_element(
                    page=mock_page,
                    selector_key="compose.post_input",
                    selectors_dict={"compose": {"post_input": "broken_old"}},
                    config_path=config_file,
                )

            assert "compose.post_input" in str(exc_info.value)
            with open(config_file) as f:
                disk_data = json.load(f)
            assert disk_data == initial_content
