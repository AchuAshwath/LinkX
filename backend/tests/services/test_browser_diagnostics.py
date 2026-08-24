import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from app.services.browser.diagnostics import (
    extract_dom_snapshot,
    extract_grok_summary,
    extract_structural_map,
)


@pytest.mark.anyio
async def test_extract_dom_snapshot_without_file() -> None:
    """Test extract_dom_snapshot returns full HTML content without saving to disk."""
    mock_page = AsyncMock()
    mock_page.content = AsyncMock(
        return_value="<html><body><div>DOM content</div></body></html>"
    )

    html = await extract_dom_snapshot(mock_page)

    assert html == "<html><body><div>DOM content</div></body></html>"
    mock_page.content.assert_awaited_once()


@pytest.mark.anyio
async def test_extract_dom_snapshot_with_file(tmp_path: Path) -> None:
    """Test extract_dom_snapshot writes HTML to output_path and creates parent directories."""
    output_file = tmp_path / "snapshots" / "page_snap.html"

    mock_page = AsyncMock()
    mock_page.content = AsyncMock(return_value="<html><body>Snapshot</body></html>")

    html = await extract_dom_snapshot(mock_page, output_path=output_file)

    assert html == "<html><body>Snapshot</body></html>"
    assert output_file.exists()
    assert (
        output_file.read_text(encoding="utf-8") == "<html><body>Snapshot</body></html>"
    )


@pytest.mark.anyio
async def test_extract_structural_map_element_found(tmp_path: Path) -> None:
    """Test extract_structural_map executes JS serializer and saves JSON if requested."""
    output_file = tmp_path / "structure" / "map.json"

    expected_tree = {
        "tag": "div",
        "attrs": {"data-testid": "tweetTextarea_0"},
        "children": [
            {"tag": "span", "attrs": {}, "text": "Hello world", "children": []}
        ],
    }

    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(return_value=expected_tree)

    result = await extract_structural_map(
        mock_page, "div[data-testid='tweetTextarea_0']", output_path=output_file
    )

    assert result == expected_tree
    assert output_file.exists()
    assert json.loads(output_file.read_text(encoding="utf-8")) == expected_tree


@pytest.mark.anyio
async def test_extract_structural_map_element_not_found() -> None:
    """Test extract_structural_map returns None when element is not found."""
    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(return_value=None)

    result = await extract_structural_map(mock_page, "div#non-existent")

    assert result is None


@pytest.mark.anyio
async def test_extract_grok_summary_success() -> None:
    """Test extract_grok_summary returns non-empty summary extracted by browser JS."""
    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(
        return_value="Autonomous AI agents are accelerating software delivery across enterprise engineering teams."
    )

    summary = await extract_grok_summary(mock_page)

    assert "Autonomous AI agents" in summary
    mock_page.evaluate.assert_awaited_once()


@pytest.mark.anyio
async def test_extract_grok_summary_exception_returns_empty_string() -> None:
    """Test extract_grok_summary returns empty string when JS evaluation fails."""
    mock_page = AsyncMock()
    mock_page.evaluate = AsyncMock(side_effect=RuntimeError("JS evaluation failed"))

    summary = await extract_grok_summary(mock_page)

    assert summary == ""
