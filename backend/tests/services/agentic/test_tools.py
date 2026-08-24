import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.browser.tools import (
    SelectorHealingError,
    find_or_heal_element,
    get_dom_snippet,
    patch_selector_config,
    validate_selector_candidate,
)


@pytest.mark.anyio
async def test_get_dom_snippet_prunes_dom() -> None:
    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(
        return_value="""
        <div data-testid="sidebarColumn">
            <a href="/search?q=AI" data-testid="news_sidebar_article">AI Trending</a>
            <button role="button" aria-label="Follow">Follow</button>
        </div>
        """
    )

    snippet = await get_dom_snippet(page=mock_page, max_chars=1000)

    assert "sidebarColumn" in snippet
    assert "AI Trending" in snippet
    mock_page.evaluate.assert_awaited_once()


@pytest.mark.anyio
async def test_get_dom_snippet_truncates_large_dom() -> None:
    large_dom = "<div data-testid='container'>" + ("<span>Item</span>" * 500) + "</div>"
    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(return_value=large_dom)

    snippet = await get_dom_snippet(page=mock_page, max_chars=200)

    assert len(snippet) <= 200
    assert "data-testid" in snippet


@pytest.mark.anyio
async def test_validate_selector_candidate_success() -> None:
    mock_locator = AsyncMock()
    mock_locator.count = AsyncMock(return_value=1)
    mock_locator.first = mock_locator
    mock_locator.is_visible = AsyncMock(return_value=True)

    mock_page = MagicMock()
    mock_page.locator = MagicMock(return_value=mock_locator)

    result = await validate_selector_candidate(
        page=mock_page, selector="div[data-testid='tweetTextarea_0']"
    )

    assert result["found"] is True
    assert result["visible"] is True
    assert result["count"] == 1
    assert result["error"] is None


@pytest.mark.anyio
async def test_validate_selector_candidate_failure() -> None:
    mock_locator = AsyncMock()
    mock_locator.count = AsyncMock(return_value=0)
    mock_locator.first = mock_locator
    mock_locator.is_visible = AsyncMock(return_value=False)

    mock_page = MagicMock()
    mock_page.locator = MagicMock(return_value=mock_locator)

    result = await validate_selector_candidate(
        page=mock_page, selector="div[data-testid='nonexistent']"
    )

    assert result["found"] is False
    assert result["visible"] is False
    assert result["count"] == 0


@pytest.mark.anyio
async def test_validate_selector_candidate_syntax_error() -> None:
    mock_page = MagicMock()
    mock_page.locator = MagicMock(side_effect=Exception("Invalid selector syntax"))

    result = await validate_selector_candidate(
        page=mock_page, selector=":::invalid[[selector"
    )

    assert result["found"] is False
    assert result["visible"] is False
    assert result["count"] == 0
    assert result["error"] is not None
    assert "Invalid selector syntax" in result["error"]


def test_patch_selector_config_nested_key(tmp_path: Path) -> None:
    config_file = tmp_path / "test_selectors.json"
    initial_data = {
        "compose": {
            "post_input": "div.old-selector",
            "post_button": "button.submit",
        }
    }
    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(initial_data, f, indent=2)

    success = patch_selector_config(
        config_path=config_file,
        key_path="compose.post_input",
        new_selector="div[data-testid='tweetTextarea_0']",
    )

    assert success is True
    with open(config_file, encoding="utf-8") as f:
        updated = json.load(f)
    assert updated["compose"]["post_input"] == "div[data-testid='tweetTextarea_0']"
    assert updated["compose"]["post_button"] == "button.submit"


def test_patch_selector_config_creates_missing_intermediate_keys(
    tmp_path: Path,
) -> None:
    config_file = tmp_path / "empty_selectors.json"
    with open(config_file, "w", encoding="utf-8") as f:
        json.dump({}, f)

    success = patch_selector_config(
        config_path=config_file,
        key_path="navigation.explore_tab",
        new_selector="a[href='/explore']",
    )

    assert success is True
    with open(config_file, encoding="utf-8") as f:
        updated = json.load(f)
    assert updated["navigation"]["explore_tab"] == "a[href='/explore']"


@pytest.mark.anyio
async def test_find_or_heal_element_happy_path() -> None:
    mock_locator = AsyncMock()
    mock_locator.count = AsyncMock(return_value=1)
    mock_locator.first = mock_locator
    mock_locator.is_visible = AsyncMock(return_value=True)

    mock_page = MagicMock()
    mock_page.locator = MagicMock(return_value=mock_locator)

    selectors_dict = {"compose": {"post_input": "div[data-testid='tweetTextarea_0']"}}

    element = await find_or_heal_element(
        page=mock_page,
        selector_key="compose.post_input",
        selectors_dict=selectors_dict,
        config_path="dummy.json",
    )

    assert element is not None
    mock_page.locator.assert_called_with("div[data-testid='tweetTextarea_0']")


@pytest.mark.anyio
async def test_find_or_heal_element_triggers_healing_when_broken(
    tmp_path: Path,
) -> None:
    config_file = tmp_path / "x_selectors.json"
    with open(config_file, "w", encoding="utf-8") as f:
        json.dump({"compose": {"post_input": "broken_old_selector"}}, f)

    mock_broken_locator = AsyncMock()
    mock_broken_locator.count = AsyncMock(return_value=0)
    mock_broken_locator.first = mock_broken_locator
    mock_broken_locator.is_visible = AsyncMock(return_value=False)

    mock_healed_locator = AsyncMock()
    mock_healed_locator.count = AsyncMock(return_value=1)
    mock_healed_locator.first = mock_healed_locator
    mock_healed_locator.is_visible = AsyncMock(return_value=True)

    def locator_side_effect(sel: str) -> Any:
        if sel == "broken_old_selector":
            return mock_broken_locator
        if sel == "healed_new_selector":
            return mock_healed_locator
        return mock_broken_locator

    mock_page = MagicMock()
    mock_page.locator = MagicMock(side_effect=locator_side_effect)

    selectors_dict = {"compose": {"post_input": "broken_old_selector"}}

    with patch(
        "app.services.agentic.self_healing_graph.heal_selector",
        new_callable=AsyncMock,
    ) as mock_heal:
        mock_heal.return_value = "healed_new_selector"

        element = await find_or_heal_element(
            page=mock_page,
            selector_key="compose.post_input",
            selectors_dict=selectors_dict,
            config_path=config_file,
        )

        assert element is not None
        mock_heal.assert_awaited_once()
        assert selectors_dict["compose"]["post_input"] == "healed_new_selector"


@pytest.mark.anyio
async def test_find_or_heal_element_raises_when_unrecoverable(
    tmp_path: Path,
) -> None:
    config_file = tmp_path / "x_selectors.json"
    initial_content = {"compose": {"post_input": "broken_old_selector"}}
    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(initial_content, f)

    mock_broken_locator = AsyncMock()
    mock_broken_locator.count = AsyncMock(return_value=0)
    mock_broken_locator.first = mock_broken_locator
    mock_broken_locator.is_visible = AsyncMock(return_value=False)

    mock_page = MagicMock()
    mock_page.locator = MagicMock(return_value=mock_broken_locator)

    selectors_dict = {"compose": {"post_input": "broken_old_selector"}}

    with patch(
        "app.services.agentic.self_healing_graph.heal_selector",
        new_callable=AsyncMock,
    ) as mock_heal:
        mock_heal.return_value = None  # Healing failed

        with pytest.raises(SelectorHealingError) as exc_info:
            await find_or_heal_element(
                page=mock_page,
                selector_key="compose.post_input",
                selectors_dict=selectors_dict,
                config_path=config_file,
            )

        assert "compose.post_input" in str(exc_info.value)
        # Ensure memory and disk remain uncorrupted
        assert selectors_dict["compose"]["post_input"] == "broken_old_selector"
        with open(config_file, encoding="utf-8") as f:
            disk_data = json.load(f)
        assert disk_data == initial_content


@pytest.mark.anyio
async def test_get_dom_snippet_with_scoped_selector() -> None:
    """Test G11: get_dom_snippet with a specific selector parameter and element not found fallback."""
    from unittest.mock import ANY

    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(
        return_value="<aside role='complementary'><div>Sidebar content</div></aside>"
    )

    # 1. Scoped selector evaluation
    snippet = await get_dom_snippet(
        page=mock_page, selector="aside[role='complementary']", max_chars=1000
    )
    assert 'role="complementary"' in snippet or "complementary" in snippet
    mock_page.evaluate.assert_awaited_with(ANY, "aside[role='complementary']")

    # 2. Scoped element not found fallback
    mock_page.evaluate = AsyncMock(return_value="<div>Element not found</div>")
    snippet_not_found = await get_dom_snippet(
        page=mock_page, selector="div#does-not-exist"
    )
    assert snippet_not_found == "<div>Element not found</div>"
