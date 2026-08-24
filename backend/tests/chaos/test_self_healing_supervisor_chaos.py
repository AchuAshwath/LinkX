"""Chaos and fault tolerance testing suite for the LangGraph self-healing supervisor."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.agentic.schemas import SelectorCandidate, SelectorDiagnosisReport
from app.services.agentic.self_healing_graph import heal_selector
from app.services.browser.tools import (
    SelectorHealingError,
    find_or_heal_element,
    patch_selector_config,
)
from tests.helpers.mock_browser import build_mock_locator


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
                selector="div.detached",
                confidence=0.95,
                reasoning="Detached element",
            ),
            SelectorCandidate(
                selector="div.hidden-input",
                confidence=0.90,
                reasoning="Hidden element",
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
        """Attack Vector 4A: Stream with invalid syntax, detached elements, and hidden elements falls back to valid candidate."""
        config_file = tmp_path / "selectors.json"
        config_file.write_text('{"compose": {"post_input": "broken_old"}}')

        mock_page = _build_adversarial_page()
        diagnosis = _build_adversarial_diagnosis()
        mock_structured_model = AsyncMock(ainvoke=AsyncMock(return_value=diagnosis))

        with patch(
            "app.services.agentic.self_healing_graph.get_chat_model"
        ) as mock_get_model:
            mock_model = MagicMock(
                with_structured_output=MagicMock(return_value=mock_structured_model)
            )
            mock_get_model.return_value = mock_model

            selectors_dict = {"compose": {"post_input": "broken_old"}}
            healed = await heal_selector(
                page=mock_page,
                failed_selector_key="compose.post_input",
                config_path=config_file,
                selectors_dict=selectors_dict,
            )

            assert healed == "div[data-testid='tweetTextarea_0']"
            assert (
                selectors_dict["compose"]["post_input"]
                == "div[data-testid='tweetTextarea_0']"
            )
            with open(config_file) as f:
                disk = json.load(f)
            assert disk["compose"]["post_input"] == "div[data-testid='tweetTextarea_0']"

    @pytest.mark.anyio
    async def test_supervisor_empty_candidates_and_unrecoverable_clean_exit(
        self, tmp_path: Path
    ) -> None:
        """Attack Vector 4B: Supervisor exits cleanly without disk changes when diagnosis is unrecoverable."""
        config_file = tmp_path / "selectors.json"
        initial_content = {"compose": {"post_input": "original_val"}}
        config_file.write_text(json.dumps(initial_content))

        mock_page = AsyncMock()
        mock_page.evaluate = AsyncMock(return_value="<div>No relevant elements</div>")

        diagnosis = SelectorDiagnosisReport(
            broken_element_name="compose.post_input",
            page_state="authenticated",
            is_recoverable=False,
            candidate_selectors=[],
        )

        mock_structured_model = AsyncMock(ainvoke=AsyncMock(return_value=diagnosis))

        with patch(
            "app.services.agentic.self_healing_graph.get_chat_model"
        ) as mock_get_model:
            mock_model = MagicMock(
                with_structured_output=MagicMock(return_value=mock_structured_model)
            )
            mock_get_model.return_value = mock_model

            selectors_dict = {"compose": {"post_input": "original_val"}}
            healed = await heal_selector(
                page=mock_page,
                failed_selector_key="compose.post_input",
                config_path=config_file,
                selectors_dict=selectors_dict,
            )

            assert healed is None
            assert selectors_dict["compose"]["post_input"] == "original_val"
            assert json.loads(config_file.read_text()) == initial_content

    def test_patch_selector_config_corrupted_json_resilience(
        self, tmp_path: Path
    ) -> None:
        """Attack Vector 4C: Patching a corrupted JSON file on disk returns False without raising JSONDecodeError."""
        corrupted_file = tmp_path / "corrupted.json"
        corrupted_file.write_text("{malformed: json, not_valid_at_all! [}")

        success = patch_selector_config(
            config_path=corrupted_file,
            key_path="compose.post_input",
            new_selector="div[data-testid='tweetTextarea_0']",
        )
        assert success is False

    def test_patch_selector_config_non_existent_file(self, tmp_path: Path) -> None:
        """Attack Vector 4D: Non-existent config file returns False safely."""
        missing_file = tmp_path / "does_not_exist.json"
        success = patch_selector_config(
            config_path=missing_file,
            key_path="compose.post_input",
            new_selector="div[data-testid='tweetTextarea_0']",
        )
        assert success is False

    def test_patch_selector_config_overwriting_dict_node_edge_case(
        self, tmp_path: Path
    ) -> None:
        """Attack Vector 4E: Patching intermediate key when existing node is already a string turns it into dict."""
        config_file = tmp_path / "selectors.json"
        config_file.write_text('{"compose": "simple_string_selector"}')

        success = patch_selector_config(
            config_path=config_file,
            key_path="compose.post_input",
            new_selector="div[data-testid='tweetTextarea_0']",
        )
        assert success is True
        with open(config_file) as f:
            data = json.load(f)
        assert isinstance(data["compose"], dict)
        assert data["compose"]["post_input"] == "div[data-testid='tweetTextarea_0']"

    @pytest.mark.anyio
    async def test_find_or_heal_element_unrecoverable_preserves_state(
        self, tmp_path: Path
    ) -> None:
        """Attack Vector 4F: When healing fails completely, find_or_heal_element raises SelectorHealingError without side effects."""
        config_file = tmp_path / "selectors.json"
        initial_data = {"compose": {"post_input": "broken_selector"}}
        config_file.write_text(json.dumps(initial_data))

        mock_page = AsyncMock()
        mock_page.evaluate = AsyncMock(return_value="<div>Blank</div>")
        mock_loc = AsyncMock()
        mock_loc.count = AsyncMock(return_value=0)
        mock_loc.first = mock_loc
        mock_loc.is_visible = AsyncMock(return_value=False)
        mock_page.locator = MagicMock(return_value=mock_loc)

        selectors_dict = {"compose": {"post_input": "broken_selector"}}

        with patch(
            "app.services.agentic.self_healing_graph.heal_selector",
            new_callable=AsyncMock,
            return_value=None,
        ):
            with pytest.raises(SelectorHealingError) as exc:
                await find_or_heal_element(
                    page=mock_page,
                    selector_key="compose.post_input",
                    selectors_dict=selectors_dict,
                    config_path=config_file,
                )

            assert "compose.post_input" in str(exc.value)
            assert selectors_dict["compose"]["post_input"] == "broken_selector"
            assert json.loads(config_file.read_text()) == initial_data
