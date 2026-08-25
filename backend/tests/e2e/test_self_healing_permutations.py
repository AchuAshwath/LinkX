"""Comprehensive E2E test suite for all failure permutations and LangGraph self-healing orchestration."""

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.agentic.schemas import (
    SelectorCandidate,
    SelectorDiagnosisReport,
)
from app.services.agentic.self_healing_graph import (
    heal_selector,
)
from app.services.browser.tools import (
    SelectorHealingError,
    find_or_heal_element,
)
from app.services.x_posts import (
    enter_compose_text,
)
from scripts.scrape_trending_topics import extract_trending_sidebar

# ==============================================================================
# 1. SELECTOR FAILURE PERMUTATIONS
# ==============================================================================


@pytest.mark.anyio
async def test_e2e_permutation_deprecated_testid_heals(tmp_path: Path) -> None:
    """Case 1A: Broken/deprecated data-testid heals to new data-testid on live page."""
    config_file = tmp_path / "selectors.json"
    config_file.write_text(
        '{"compose": {"post_input": "div[data-testid=\'deprecated_input_v1\']"}}'
    )

    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(
        return_value='<div data-testid="tweetTextarea_0" role="textbox"></div>'
    )

    mock_broken = AsyncMock()
    mock_broken.count = AsyncMock(return_value=0)
    mock_broken.first = mock_broken
    mock_broken.is_visible = AsyncMock(return_value=False)

    mock_healed = AsyncMock()
    mock_healed.count = AsyncMock(return_value=1)
    mock_healed.first = mock_healed
    mock_healed.is_visible = AsyncMock(return_value=True)
    mock_healed.click = AsyncMock()
    mock_healed.fill = AsyncMock()

    mock_page.locator = MagicMock(
        side_effect=lambda s: mock_healed
        if s == "div[data-testid='tweetTextarea_0']"
        else mock_broken
    )

    selectors_dict = {
        "compose": {"post_input": "div[data-testid='deprecated_input_v1']"}
    }

    diagnosis_payload = {
        "failed_element_name": "compose.post_input",
        "diagnosis": {"root_cause": "Deprecated testid", "impact": "Element not found"},
        "candidate_selectors": [
            {
                "selector": "div[data-testid='tweetTextarea_0']",
                "confidence": 0.98,
                "reasoning": "Modern testid",
            }
        ],
    }
    mock_structured_model = AsyncMock(
        ainvoke=AsyncMock(
            return_value=SelectorDiagnosisReport.model_validate(diagnosis_payload)
        )
    )

    with (
        patch(
            "app.services.agentic.self_healing_graph.get_chat_model"
        ) as mock_get_model,
        patch(
            "app.services.x_posts.HumanTyper.type", new_callable=AsyncMock
        ) as mock_type,
    ):
        mock_model = MagicMock(
            with_structured_output=MagicMock(return_value=mock_structured_model)
        )
        mock_get_model.return_value = mock_model

        success = await enter_compose_text(
            page=mock_page,
            text="E2E test post",
            selectors=selectors_dict,
            config_path=config_file,
        )

        assert success is True
        mock_type.assert_awaited_once()
        assert (
            selectors_dict["compose"]["post_input"]
            == "div[data-testid='tweetTextarea_0']"
        )
        with open(config_file) as f:
            disk_data = json.load(f)
        assert (
            disk_data["compose"]["post_input"] == "div[data-testid='tweetTextarea_0']"
        )


@pytest.mark.anyio
async def test_e2e_permutation_role_and_aria_fallback(tmp_path: Path) -> None:
    """Case 1B: Broken CSS class heals to accessible role + aria-label landmark."""
    config_file = tmp_path / "scrape_config.json"
    config_file.write_text(
        '{"selectors": {"sidebar_container": "div.old-sidebar-class"}}'
    )

    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(
        return_value='<div role="complementary" aria-label="Timeline: Trending now"><a href="/search?q=AI">AI</a></div>'
    )

    mock_broken = AsyncMock()
    mock_broken.count = AsyncMock(return_value=0)
    mock_broken.first = mock_broken
    mock_broken.is_visible = AsyncMock(return_value=False)

    mock_link = AsyncMock(
        get_attribute=AsyncMock(return_value="/search?q=AI"),
        inner_text=AsyncMock(
            return_value="Technology · Trending\nAI Trends\n50K posts"
        ),
    )
    mock_links = MagicMock(all=AsyncMock(return_value=[mock_link]))

    mock_healed = MagicMock()
    mock_healed.count = AsyncMock(return_value=1)
    mock_healed.first = mock_healed
    mock_healed.is_visible = AsyncMock(return_value=True)
    mock_healed.locator = MagicMock(return_value=mock_links)

    target_selector = "div[role='complementary'][aria-label='Timeline: Trending now']"
    mock_page.locator = MagicMock(
        side_effect=lambda s: mock_healed if s == target_selector else mock_broken
    )

    selectors_dict = {
        "selectors": {
            "sidebar_container": "div.old-sidebar-class",
            "sidebar_link": "a[href*='/search?q=']",
        }
    }

    diagnosis_payload = {
        "broken_element_name": "selectors.sidebar_container",
        "page_state": "authenticated",
        "candidates": [
            {
                "selector": target_selector,
                "score": 0.95,
                "description": "ARIA landmark with timeline label",
            }
        ],
    }
    mock_structured_model = AsyncMock(
        ainvoke=AsyncMock(
            return_value=SelectorDiagnosisReport.model_validate(diagnosis_payload)
        )
    )

    with patch(
        "app.services.agentic.self_healing_graph.get_chat_model"
    ) as mock_get_model:
        mock_model = MagicMock(
            with_structured_output=MagicMock(return_value=mock_structured_model)
        )
        mock_get_model.return_value = mock_model

        topics = await extract_trending_sidebar(
            page=mock_page,
            selectors=selectors_dict,
            config_path=config_file,
        )

        assert len(topics) == 1
        assert "AI Trends" in topics[0].topic_title
        assert selectors_dict["selectors"]["sidebar_container"] == target_selector


@pytest.mark.anyio
async def test_e2e_permutation_malformed_syntax_selector_safe_recovery(
    tmp_path: Path,
) -> None:
    """Case 1E: Malformed selector syntax does not crash Playwright; heals cleanly."""
    config_file = tmp_path / "selectors.json"
    config_file.write_text('{"compose": {"post_input": "div[[[::invalid---syntax"}}')

    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(
        return_value='<div data-testid="tweetTextarea_0"></div>'
    )

    mock_valid_loc = AsyncMock()
    mock_valid_loc.count = AsyncMock(return_value=1)
    mock_valid_loc.first = mock_valid_loc
    mock_valid_loc.is_visible = AsyncMock(return_value=True)

    def locator_side_effect(sel: str) -> Any:
        if sel == "div[[[::invalid---syntax":
            raise Exception("DOMException: Failed to execute 'querySelector'")
        if sel == "div[data-testid='tweetTextarea_0']":
            return mock_valid_loc
        broken = AsyncMock()
        broken.count = AsyncMock(return_value=0)
        broken.first = broken
        broken.is_visible = AsyncMock(return_value=False)
        return broken

    mock_page.locator = MagicMock(side_effect=locator_side_effect)

    selectors_dict = {"compose": {"post_input": "div[[[::invalid---syntax"}}

    mock_diagnosis = SelectorDiagnosisReport(
        broken_element_name="compose.post_input",
        page_state="authenticated",
        is_recoverable=True,
        candidate_selectors=[
            SelectorCandidate(
                selector="div[data-testid='tweetTextarea_0']",
                confidence=0.95,
                reasoning="Valid testid",
            )
        ],
    )

    mock_structured_model = AsyncMock(ainvoke=AsyncMock(return_value=mock_diagnosis))

    with patch(
        "app.services.agentic.self_healing_graph.get_chat_model"
    ) as mock_get_model:
        mock_model = MagicMock(
            with_structured_output=MagicMock(return_value=mock_structured_model)
        )
        mock_get_model.return_value = mock_model

        elem = await find_or_heal_element(
            page=mock_page,
            selector_key="compose.post_input",
            selectors_dict=selectors_dict,
            config_path=config_file,
        )

        assert elem is not None
        assert (
            selectors_dict["compose"]["post_input"]
            == "div[data-testid='tweetTextarea_0']"
        )


@pytest.mark.anyio
async def test_e2e_permutation_unrecoverable_element_missing_from_dom(
    tmp_path: Path,
) -> None:
    """Case 1F: Unrecoverable element missing from DOM raises SelectorHealingError without corrupting state."""
    config_file = tmp_path / "selectors.json"
    initial_content = {"compose": {"post_input": "broken_old_selector"}}
    config_file.write_text(json.dumps(initial_content))

    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(return_value="<div>Empty page</div>")

    mock_broken = AsyncMock()
    mock_broken.count = AsyncMock(return_value=0)
    mock_broken.first = mock_broken
    mock_broken.is_visible = AsyncMock(return_value=False)
    mock_page.locator = MagicMock(return_value=mock_broken)

    selectors_dict = {"compose": {"post_input": "broken_old_selector"}}

    mock_diagnosis = SelectorDiagnosisReport(
        broken_element_name="compose.post_input",
        page_state="authenticated",
        is_recoverable=False,
        candidate_selectors=[],
    )
    mock_structured_model = AsyncMock(ainvoke=AsyncMock(return_value=mock_diagnosis))

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
                selector_key="compose.post_input",
                selectors_dict=selectors_dict,
                config_path=config_file,
            )

        assert "compose.post_input" in str(exc_info.value)
        assert selectors_dict["compose"]["post_input"] == "broken_old_selector"
        assert json.loads(config_file.read_text()) == initial_content


# ==============================================================================
# 2. LLM RESPONSE & SCHEMA PERMUTATIONS
# ==============================================================================


@pytest.mark.anyio
async def test_e2e_permutation_llm_nested_dict_diagnosis_payload(
    tmp_path: Path,
) -> None:
    """Case 3A: LLM returns complex nested dicts for diagnosis/root_cause; parsed without ValidationError."""
    config_file = tmp_path / "selectors.json"
    config_file.write_text('{"compose": {"post_input": "broken"}}')

    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(return_value='<div data-testid="healed"></div>')

    mock_healed = AsyncMock()
    mock_healed.count = AsyncMock(return_value=1)
    mock_healed.first = mock_healed
    mock_healed.is_visible = AsyncMock(return_value=True)

    def loc_fn(s: str) -> Any:
        if s == "div[data-testid='healed']":
            return mock_healed
        broken = AsyncMock()
        broken.count = AsyncMock(return_value=0)
        broken.first = broken
        broken.is_visible = AsyncMock(return_value=False)
        return broken

    mock_page.locator = MagicMock(side_effect=loc_fn)

    raw_llm_dict = {
        "failed_element_name": "compose.post_input",
        "broken_selector": "broken",
        "diagnosis": {
            "root_cause": "The selector targeted a deprecated/fictitious attribute that does not exist in DOM.",
            "actual_element_found": '<div data-testid="healed">',
            "impact": "Automation fails to locate composer.",
        },
        "candidate_selectors": [
            {
                "selector": "div[data-testid='healed']",
                "strategy": "data-testid",
                "confidence": 0.98,
                "specificity": "high",
                "reasoning": "Direct attribute match.",
            }
        ],
    }

    report = SelectorDiagnosisReport.model_validate(raw_llm_dict)
    assert report.broken_element_name == "compose.post_input"
    assert len(report.candidate_selectors) == 1
    assert report.candidate_selectors[0].selector == "div[data-testid='healed']"

    mock_structured_model = AsyncMock(ainvoke=AsyncMock(return_value=report))

    with patch(
        "app.services.agentic.self_healing_graph.get_chat_model"
    ) as mock_get_model:
        mock_model = MagicMock(
            with_structured_output=MagicMock(return_value=mock_structured_model)
        )
        mock_get_model.return_value = mock_model

        healed = await heal_selector(
            page=mock_page,
            failed_selector_key="compose.post_input",
            config_path=config_file,
        )

        assert healed == "div[data-testid='healed']"


@pytest.mark.anyio
async def test_e2e_permutation_llm_string_only_candidate_list(tmp_path: Path) -> None:
    """Case 3B: LLM returns plain list of strings for candidates; coerced cleanly."""
    config_file = tmp_path / "selectors.json"
    config_file.write_text('{"compose": {"post_input": "broken"}}')

    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(return_value='<div data-testid="healed"></div>')

    mock_healed = AsyncMock()
    mock_healed.count = AsyncMock(return_value=1)
    mock_healed.first = mock_healed
    mock_healed.is_visible = AsyncMock(return_value=True)

    def loc_fn(s: str) -> Any:
        if s == "div[data-testid='healed']":
            return mock_healed
        broken = AsyncMock()
        broken.count = AsyncMock(return_value=0)
        broken.first = broken
        broken.is_visible = AsyncMock(return_value=False)
        return broken

    mock_page.locator = MagicMock(side_effect=loc_fn)

    raw_llm_dict = {
        "failed_element": "compose.post_input",
        "candidates": ["div[data-testid='healed']", "div.fallback"],
    }

    report = SelectorDiagnosisReport.model_validate(raw_llm_dict)
    assert len(report.candidate_selectors) == 2
    assert report.candidate_selectors[0].selector == "div[data-testid='healed']"
    assert report.candidate_selectors[0].confidence >= 0.85

    mock_structured_model = AsyncMock(ainvoke=AsyncMock(return_value=report))

    with patch(
        "app.services.agentic.self_healing_graph.get_chat_model"
    ) as mock_get_model:
        mock_model = MagicMock(
            with_structured_output=MagicMock(return_value=mock_structured_model)
        )
        mock_get_model.return_value = mock_model

        healed = await heal_selector(
            page=mock_page,
            failed_selector_key="compose.post_input",
            config_path=config_file,
        )
        assert healed == "div[data-testid='healed']"
