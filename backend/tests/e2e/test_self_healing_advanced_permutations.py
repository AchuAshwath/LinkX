"""Advanced E2E test suite for self-healing permutations and multi-step healing cascades."""

import asyncio
import json
from contextlib import asynccontextmanager
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
    find_or_heal_element,
    patch_selector_config,
)
from app.services.x_posts import (
    enter_compose_text,
    submit_and_verify_post,
)


@pytest.mark.anyio
async def test_e2e_permutation_llm_percentage_and_alias_scores() -> None:
    """Case 3C: LLM returns percentage strings (e.g. '95%') and description aliases; coerced to float."""
    raw_llm_dict = {
        "element_name": "sidebar",
        "selectors": [
            {
                "locator": "[data-testid='sidebarColumn']",
                "score": "95%",
                "description": "Matches sidebar",
            },
            {
                "locator": "[role='complementary']",
                "weight": "80%",
                "reason": "Role landmark",
            },
        ],
    }
    report = SelectorDiagnosisReport.model_validate(raw_llm_dict)
    assert report.candidate_selectors[0].selector == "[data-testid='sidebarColumn']"
    assert report.candidate_selectors[0].confidence == 0.95
    assert report.candidate_selectors[0].reasoning == "Matches sidebar"
    assert report.candidate_selectors[1].confidence == 0.80


@pytest.mark.anyio
async def test_e2e_permutation_llm_network_timeout_or_500_error(tmp_path: Path) -> None:
    """Case 3D: LLM proxy throws network/timeout exception; supervisor returns None without crashing."""
    config_file = tmp_path / "selectors.json"
    initial_data = {"compose": {"post_input": "broken"}}
    config_file.write_text(json.dumps(initial_data))

    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(return_value="<div>DOM</div>")

    mock_structured_model = AsyncMock(
        ainvoke=AsyncMock(side_effect=RuntimeError("504 Gateway Timeout on Proxy"))
    )

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
        assert healed is None
        assert json.loads(config_file.read_text()) == initial_data


@pytest.mark.anyio
async def test_e2e_permutation_candidates_all_fail_verification(tmp_path: Path) -> None:
    """Case 3E: Proposed candidates all fail live page check; supervisor exits without patching."""
    config_file = tmp_path / "selectors.json"
    initial_data = {"compose": {"post_input": "broken"}}
    config_file.write_text(json.dumps(initial_data))

    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(return_value="<div>DOM</div>")
    mock_broken = AsyncMock()
    mock_broken.count = AsyncMock(return_value=0)
    mock_broken.first = mock_broken
    mock_broken.is_visible = AsyncMock(return_value=False)
    mock_page.locator = MagicMock(return_value=mock_broken)

    report = SelectorDiagnosisReport(
        broken_element_name="compose.post_input",
        page_state="authenticated",
        is_recoverable=True,
        candidate_selectors=[
            SelectorCandidate(
                selector="candidate_1", confidence=0.9, reasoning="Guess 1"
            ),
            SelectorCandidate(
                selector="candidate_2", confidence=0.8, reasoning="Guess 2"
            ),
        ],
    )
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
        assert healed is None
        assert json.loads(config_file.read_text()) == initial_data


def test_e2e_permutation_nested_json_config_deep_creation(tmp_path: Path) -> None:
    """Case 4A: Patching deeply nested intermediate keys in empty/sparse JSON files."""
    config_file = tmp_path / "empty.json"
    config_file.write_text("{}")

    success = patch_selector_config(
        config_path=config_file,
        key_path="modules.scraping.sidebar.container_box",
        new_selector="[data-testid='sidebarColumn']",
    )
    assert success is True
    with open(config_file) as f:
        data = json.load(f)
    assert (
        data["modules"]["scraping"]["sidebar"]["container_box"]
        == "[data-testid='sidebarColumn']"
    )


@pytest.mark.anyio
async def test_e2e_permutation_in_memory_fast_path_cache_hit(tmp_path: Path) -> None:
    """Case 4C: First call heals and updates memory cache; subsequent call hits fast path (0 LLM calls)."""
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
    selectors_dict = {"compose": {"post_input": "broken"}}

    report = SelectorDiagnosisReport(
        broken_element_name="compose.post_input",
        page_state="authenticated",
        is_recoverable=True,
        candidate_selectors=[
            SelectorCandidate(
                selector="div[data-testid='healed']", confidence=0.98, reasoning="Match"
            )
        ],
    )
    mock_structured_model = AsyncMock(ainvoke=AsyncMock(return_value=report))

    with patch(
        "app.services.agentic.self_healing_graph.get_chat_model"
    ) as mock_get_model:
        mock_model = MagicMock(
            with_structured_output=MagicMock(return_value=mock_structured_model)
        )
        mock_get_model.return_value = mock_model

        elem1 = await find_or_heal_element(
            page=mock_page,
            selector_key="compose.post_input",
            selectors_dict=selectors_dict,
            config_path=config_file,
        )
        assert elem1 is not None
        assert mock_structured_model.ainvoke.await_count == 1

        elem2 = await find_or_heal_element(
            page=mock_page,
            selector_key="compose.post_input",
            selectors_dict=selectors_dict,
            config_path=config_file,
        )
        assert elem2 is not None
        assert mock_structured_model.ainvoke.await_count == 1


@pytest.mark.anyio
async def test_e2e_permutation_multi_step_publishing_healing_cascade(
    tmp_path: Path,
) -> None:
    """Case 5B: Full multi-step compose + publish flow with broken textarea AND broken post button."""
    config_file = tmp_path / "selectors.json"
    config_file.write_text(
        json.dumps(
            {
                "compose": {
                    "post_input": "broken_input",
                    "post_button": "broken_button",
                }
            }
        )
    )

    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(
        return_value='<div data-testid="tweetTextarea_0"></div><button data-testid="tweetButtonInline">Post</button>'
    )

    mock_input_loc = AsyncMock()
    mock_input_loc.count = AsyncMock(return_value=1)
    mock_input_loc.first = mock_input_loc
    mock_input_loc.is_visible = AsyncMock(return_value=True)
    mock_input_loc.click = AsyncMock()

    mock_btn_loc = AsyncMock()
    mock_btn_loc.count = AsyncMock(return_value=1)
    mock_btn_loc.first = mock_btn_loc
    mock_btn_loc.is_visible = AsyncMock(return_value=True)
    mock_btn_loc.is_enabled = AsyncMock(return_value=True)

    def locator_side_effect(sel: str) -> Any:
        if sel == "div[data-testid='tweetTextarea_0']":
            return mock_input_loc
        if sel == "button[data-testid='tweetButtonInline']":
            return mock_btn_loc
        broken = AsyncMock()
        broken.count = AsyncMock(return_value=0)
        broken.first = broken
        broken.is_visible = AsyncMock(return_value=False)
        return broken

    mock_page.locator = MagicMock(side_effect=locator_side_effect)

    mock_response = AsyncMock(
        status=200,
        json=AsyncMock(
            return_value={
                "data": {
                    "create_tweet": {
                        "tweet_results": {"result": {"rest_id": "999888777"}}
                    }
                }
            }
        ),
    )

    @asynccontextmanager
    async def mock_expect_response(*_args: Any, **_kwargs: Any) -> Any:
        val = MagicMock()
        fut: asyncio.Future[Any] = asyncio.Future()
        fut.set_result(mock_response)
        val.value = fut
        yield val

    mock_page.expect_response = mock_expect_response

    selectors_dict = {
        "compose": {
            "post_input": "broken_input",
            "post_button": "broken_button",
        }
    }

    def model_ainvoke_side_effect(messages: list[Any]) -> Any:
        content = messages[1]["content"] if len(messages) > 1 else ""
        if "post_input" in content:
            return SelectorDiagnosisReport(
                broken_element_name="compose.post_input",
                page_state="authenticated",
                is_recoverable=True,
                candidate_selectors=[
                    SelectorCandidate(
                        selector="div[data-testid='tweetTextarea_0']",
                        confidence=0.98,
                        reasoning="Textarea match",
                    )
                ],
            )
        return SelectorDiagnosisReport(
            broken_element_name="compose.post_button",
            page_state="authenticated",
            is_recoverable=True,
            candidate_selectors=[
                SelectorCandidate(
                    selector="button[data-testid='tweetButtonInline']",
                    confidence=0.98,
                    reasoning="Button match",
                )
            ],
        )

    mock_structured_model = AsyncMock(
        ainvoke=AsyncMock(side_effect=model_ainvoke_side_effect)
    )

    with (
        patch(
            "app.services.agentic.self_healing_graph.get_chat_model"
        ) as mock_get_model,
        patch(
            "app.services.x_posts.HumanTyper.type", new_callable=AsyncMock
        ) as mock_type,
        patch(
            "app.services.browser.actions.EvasionMouse.human_click",
            new_callable=AsyncMock,
        ) as mock_click,
    ):
        mock_model = MagicMock(
            with_structured_output=MagicMock(return_value=mock_structured_model)
        )
        mock_get_model.return_value = mock_model

        success_type = await enter_compose_text(
            page=mock_page,
            text="Autonomous multi-step test",
            selectors=selectors_dict,
            config_path=config_file,
        )
        assert success_type is True
        mock_type.assert_awaited_once()

        result = await submit_and_verify_post(
            page=mock_page,
            selectors=selectors_dict,
            config_path=config_file,
        )
        assert result.success is True
        mock_click.assert_awaited_once()
        assert result.post_id == "999888777"
