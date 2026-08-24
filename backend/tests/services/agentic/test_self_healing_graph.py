import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.agentic.schemas import SelectorCandidate, SelectorDiagnosisReport
from app.services.agentic.self_healing_graph import heal_selector


@pytest.mark.anyio
async def test_heal_selector_success_loop(tmp_path: Path) -> None:
    config_file = tmp_path / "x_selectors.json"
    with open(config_file, "w", encoding="utf-8") as f:
        json.dump({"compose": {"post_input": "broken_selector"}}, f)

    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(
        return_value="<div data-testid='tweetTextarea_0' role='textbox'>Tweet text</div>"
    )

    mock_locator_fail = AsyncMock()
    mock_locator_fail.count = AsyncMock(return_value=0)
    mock_locator_fail.first = mock_locator_fail
    mock_locator_fail.is_visible = AsyncMock(return_value=False)

    mock_locator_success = AsyncMock()
    mock_locator_success.count = AsyncMock(return_value=1)
    mock_locator_success.first = mock_locator_success
    mock_locator_success.is_visible = AsyncMock(return_value=True)

    def locator_side_effect(sel: str) -> Any:
        if sel == "candidate_1":
            return mock_locator_fail
        if sel == "div[data-testid='tweetTextarea_0']":
            return mock_locator_success
        return mock_locator_fail

    mock_page.locator = MagicMock(side_effect=locator_side_effect)

    mock_diagnosis = SelectorDiagnosisReport(
        broken_element_name="compose.post_input",
        page_state="authenticated",
        is_recoverable=True,
        candidate_selectors=[
            SelectorCandidate(
                selector="candidate_1",
                confidence=0.5,
                reasoning="First guess",
            ),
            SelectorCandidate(
                selector="div[data-testid='tweetTextarea_0']",
                confidence=0.98,
                reasoning="Exact testid match",
            ),
        ],
    )

    mock_structured_model = AsyncMock()
    mock_structured_model.ainvoke = AsyncMock(return_value=mock_diagnosis)

    selectors_dict = {"compose": {"post_input": "broken_selector"}}

    with patch(
        "app.services.agentic.self_healing_graph.get_chat_model"
    ) as mock_get_model:
        mock_model = MagicMock()
        mock_model.with_structured_output = MagicMock(
            return_value=mock_structured_model
        )
        mock_get_model.return_value = mock_model

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

        # Verify disk file updated
        with open(config_file, encoding="utf-8") as f:
            disk_data = json.load(f)
        assert (
            disk_data["compose"]["post_input"] == "div[data-testid='tweetTextarea_0']"
        )


@pytest.mark.anyio
async def test_heal_selector_all_candidates_fail_page_check(tmp_path: Path) -> None:
    config_file = tmp_path / "x_selectors.json"
    initial_content = {"compose": {"post_input": "broken_selector"}}
    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(initial_content, f)

    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(return_value="<div>Random DOM</div>")

    # All candidate locators fail
    mock_locator = AsyncMock()
    mock_locator.count = AsyncMock(return_value=0)
    mock_locator.first = mock_locator
    mock_locator.is_visible = AsyncMock(return_value=False)
    mock_page.locator = MagicMock(return_value=mock_locator)

    mock_diagnosis = SelectorDiagnosisReport(
        broken_element_name="compose.post_input",
        page_state="authenticated",
        is_recoverable=True,
        candidate_selectors=[
            SelectorCandidate(selector="candidate_a", confidence=0.7, reasoning="A"),
            SelectorCandidate(selector="candidate_b", confidence=0.6, reasoning="B"),
        ],
    )

    mock_structured_model = AsyncMock()
    mock_structured_model.ainvoke = AsyncMock(return_value=mock_diagnosis)

    selectors_dict = {"compose": {"post_input": "broken_selector"}}

    with patch(
        "app.services.agentic.self_healing_graph.get_chat_model"
    ) as mock_get_model:
        mock_model = MagicMock()
        mock_model.with_structured_output = MagicMock(
            return_value=mock_structured_model
        )
        mock_get_model.return_value = mock_model

        healed = await heal_selector(
            page=mock_page,
            failed_selector_key="compose.post_input",
            config_path=config_file,
            selectors_dict=selectors_dict,
        )

        assert healed is None
        assert selectors_dict["compose"]["post_input"] == "broken_selector"
        with open(config_file, encoding="utf-8") as f:
            assert json.load(f) == initial_content


@pytest.mark.anyio
async def test_heal_selector_llm_exception_handling(tmp_path: Path) -> None:
    config_file = tmp_path / "x_selectors.json"
    initial_content = {"compose": {"post_input": "broken_selector"}}
    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(initial_content, f)

    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(return_value="<div>Random DOM</div>")

    mock_structured_model = AsyncMock()
    mock_structured_model.ainvoke = AsyncMock(
        side_effect=RuntimeError("Proxy API Connection Error")
    )

    with patch(
        "app.services.agentic.self_healing_graph.get_chat_model"
    ) as mock_get_model:
        mock_model = MagicMock()
        mock_model.with_structured_output = MagicMock(
            return_value=mock_structured_model
        )
        mock_get_model.return_value = mock_model

        healed = await heal_selector(
            page=mock_page,
            failed_selector_key="compose.post_input",
            config_path=config_file,
        )

        assert healed is None
        with open(config_file, encoding="utf-8") as f:
            assert json.load(f) == initial_content


@pytest.mark.anyio
async def test_heal_selector_with_none_selectors_dict(tmp_path: Path) -> None:
    config_file = tmp_path / "x_selectors.json"
    with open(config_file, "w", encoding="utf-8") as f:
        json.dump({"compose": {"post_input": "broken_selector"}}, f)

    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(
        return_value="<div data-testid='tweetTextarea_0'>Tweet</div>"
    )

    mock_locator = AsyncMock()
    mock_locator.count = AsyncMock(return_value=1)
    mock_locator.first = mock_locator
    mock_locator.is_visible = AsyncMock(return_value=True)
    mock_page.locator = MagicMock(return_value=mock_locator)

    mock_diagnosis = SelectorDiagnosisReport(
        broken_element_name="compose.post_input",
        page_state="authenticated",
        is_recoverable=True,
        candidate_selectors=[
            SelectorCandidate(
                selector="div[data-testid='tweetTextarea_0']",
                confidence=0.99,
                reasoning="Exact match",
            )
        ],
    )

    mock_structured_model = AsyncMock()
    mock_structured_model.ainvoke = AsyncMock(return_value=mock_diagnosis)

    with patch(
        "app.services.agentic.self_healing_graph.get_chat_model"
    ) as mock_get_model:
        mock_model = MagicMock()
        mock_model.with_structured_output = MagicMock(
            return_value=mock_structured_model
        )
        mock_get_model.return_value = mock_model

        healed = await heal_selector(
            page=mock_page,
            failed_selector_key="compose.post_input",
            config_path=config_file,
            selectors_dict=None,
        )

        assert healed == "div[data-testid='tweetTextarea_0']"
        with open(config_file, encoding="utf-8") as f:
            disk_data = json.load(f)
        assert (
            disk_data["compose"]["post_input"] == "div[data-testid='tweetTextarea_0']"
        )


@pytest.mark.anyio
async def test_apply_patch_node_status_branches(tmp_path: Path) -> None:
    """Test apply_patch_node status branches for success, patch failure, and missing keys."""
    from app.services.agentic.self_healing_graph import apply_patch_node

    config_file = tmp_path / "valid_config.json"
    config_file.write_text("{}", encoding="utf-8")

    # 1. Success branch -> 'healed'
    state_success = {
        "working_selector": "button.primary",
        "target_config_path": config_file,
        "failed_selector_key": "compose.button",
    }
    res_success = await apply_patch_node(state_success)  # type: ignore[arg-type]
    assert res_success["status"] == "healed"

    # 2. Patch failure branch -> 'patch_failed' (e.g. non-existent file path)
    state_patch_fail = {
        "working_selector": "button.primary",
        "target_config_path": tmp_path / "non_existent_file.json",
        "failed_selector_key": "compose.button",
    }
    res_patch_fail = await apply_patch_node(state_patch_fail)  # type: ignore[arg-type]
    assert res_patch_fail["status"] == "patch_failed"

    # 3. Missing keys branch -> 'failed'
    state_missing_keys = {
        "working_selector": None,
        "target_config_path": config_file,
        "failed_selector_key": None,
    }
    res_missing = await apply_patch_node(state_missing_keys)  # type: ignore[arg-type]
    assert res_missing["status"] == "failed"


@pytest.mark.anyio
async def test_diagnose_dom_node_invalid_model_type() -> None:
    """Test diagnose_dom_node when model returns non-SelectorDiagnosisReport type."""
    from app.services.agentic.self_healing_graph import diagnose_dom_node

    mock_structured_model = AsyncMock()
    # Model returns raw dict instead of SelectorDiagnosisReport instance
    mock_structured_model.ainvoke = AsyncMock(return_value={"raw": "dictionary"})

    with patch(
        "app.services.agentic.self_healing_graph.get_chat_model"
    ) as mock_get_model:
        mock_model = MagicMock(
            with_structured_output=MagicMock(return_value=mock_structured_model)
        )
        mock_get_model.return_value = mock_model

        state = {
            "dom_snippet": "<div>content</div>",
            "failed_selector_key": "button.post",
        }
        res = await diagnose_dom_node(state)  # type: ignore[arg-type]

        assert res["diagnosis"] is None
        assert res["status"] == "diagnosis_failed"
        assert res["error"] == "Model returned invalid report type"


def test_route_after_diagnosis_all_states() -> None:
    """Test _route_after_diagnosis for all unrecoverable page states and happy paths."""
    from langgraph.graph import END

    from app.services.agentic.self_healing_graph import _route_after_diagnosis

    def make_state(page_state: str, is_recoverable: bool = True) -> Any:
        report = SelectorDiagnosisReport(
            broken_element_name="test_elem",
            page_state=page_state,
            is_recoverable=is_recoverable,
            candidate_selectors=[],
        )
        return {"diagnosis": report, "status": "diagnosed"}

    # Unrecoverable states route to END
    for state_name in [
        "logged_out",
        "rate_limited",
        "challenge",
        "captcha",
        "suspended",
    ]:
        assert _route_after_diagnosis(make_state(state_name)) == END

    # is_recoverable=False routes to END
    assert (
        _route_after_diagnosis(make_state("authenticated", is_recoverable=False)) == END
    )

    # Valid authenticated state routes to verify_candidates
    assert (
        _route_after_diagnosis(make_state("authenticated", is_recoverable=True))
        == "verify_candidates"
    )
