import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.x_posts import (
    XPostResult,
    attach_media_file,
    enter_compose_text,
    submit_and_verify_post,
)


@pytest.mark.anyio
async def test_modular_enter_compose_text_success() -> None:
    mock_locator = AsyncMock()
    mock_locator.count = AsyncMock(return_value=1)
    mock_locator.first = mock_locator
    mock_locator.is_visible = AsyncMock(return_value=True)
    mock_locator.click = AsyncMock()
    mock_locator.fill = AsyncMock()

    mock_page = MagicMock()
    mock_page.locator = MagicMock(return_value=mock_locator)

    selectors = {"compose": {"post_input": "div[data-testid='tweetTextarea_0']"}}

    with patch(
        "app.services.x_posts.HumanTyper.type", new_callable=AsyncMock
    ) as mock_type:
        success = await enter_compose_text(
            page=mock_page, text="Autonomous agents rule!", selectors=selectors
        )
        assert success is True
        mock_type.assert_awaited_once()


@pytest.mark.anyio
async def test_modular_enter_compose_text_heals_when_broken(tmp_path: Path) -> None:
    config_file = tmp_path / "x_selectors.json"
    config_file.write_text('{"compose": {"post_input": "broken"}}')

    mock_broken_locator = AsyncMock()
    mock_broken_locator.count = AsyncMock(return_value=0)
    mock_broken_locator.first = mock_broken_locator
    mock_broken_locator.is_visible = AsyncMock(return_value=False)

    mock_healed_locator = AsyncMock()
    mock_healed_locator.count = AsyncMock(return_value=1)
    mock_healed_locator.first = mock_healed_locator
    mock_healed_locator.is_visible = AsyncMock(return_value=True)
    mock_healed_locator.click = AsyncMock()
    mock_healed_locator.fill = AsyncMock()

    def locator_side_effect(sel: str) -> Any:
        return mock_healed_locator if sel == "healed" else mock_broken_locator

    mock_page = MagicMock()
    mock_page.locator = MagicMock(side_effect=locator_side_effect)

    selectors = {"compose": {"post_input": "broken"}}

    with (
        patch(
            "app.services.agentic.self_healing_graph.heal_selector",
            new_callable=AsyncMock,
        ) as mock_heal,
        patch(
            "app.services.x_posts.HumanTyper.type", new_callable=AsyncMock
        ) as mock_type,
    ):
        mock_heal.return_value = "healed"

        success = await enter_compose_text(
            page=mock_page,
            text="Healed text",
            selectors=selectors,
            config_path=config_file,
        )

        assert success is True
        mock_heal.assert_awaited_once()
        mock_type.assert_awaited_once()


@pytest.mark.anyio
async def test_modular_attach_media_file_success(tmp_path: Path) -> None:
    test_img = tmp_path / "test.png"
    test_img.write_text("fake image content")

    mock_file_input = AsyncMock()
    mock_file_input.count = AsyncMock(return_value=1)
    mock_file_input.first = mock_file_input
    mock_file_input.is_visible = AsyncMock(return_value=True)
    mock_file_input.set_input_files = AsyncMock()

    mock_page = AsyncMock()
    mock_page.locator = MagicMock(return_value=mock_file_input)
    mock_page.wait_for_selector = AsyncMock()

    selectors = {
        "compose": {
            "file_input": "input[data-testid='fileInput']",
            "attachments_container": "[data-testid='attachments']",
            "progress_bar": "[role='progressbar']",
        }
    }

    success = await attach_media_file(
        page=mock_page, image_path=str(test_img), selectors=selectors
    )
    assert success is True
    mock_file_input.set_input_files.assert_awaited_once_with(str(test_img))


@pytest.mark.anyio
async def test_modular_attach_media_file_missing_path() -> None:
    mock_page = AsyncMock()
    selectors = {"compose": {"file_input": "input[data-testid='fileInput']"}}

    success = await attach_media_file(
        page=mock_page, image_path="/nonexistent/image.png", selectors=selectors
    )
    assert success is False


@pytest.mark.anyio
async def test_modular_submit_and_verify_post_success() -> None:
    mock_btn = AsyncMock()
    mock_btn.count = AsyncMock(return_value=1)
    mock_btn.first = mock_btn
    mock_btn.is_visible = AsyncMock(return_value=True)
    mock_btn.is_enabled = AsyncMock(return_value=True)

    mock_page = AsyncMock()
    mock_page.locator = MagicMock(return_value=mock_btn)

    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.json = AsyncMock(
        return_value={
            "data": {
                "create_tweet": {"tweet_results": {"result": {"rest_id": "1234567890"}}}
            }
        }
    )

    @asynccontextmanager
    async def mock_expect_response(*_args: Any, **_kwargs: Any) -> Any:
        val = MagicMock()
        fut: asyncio.Future[Any] = asyncio.Future()
        fut.set_result(mock_response)
        val.value = fut
        yield val

    mock_page.expect_response = mock_expect_response

    selectors = {"compose": {"post_button": "button[data-testid='tweetButtonInline']"}}

    with patch(
        "app.services.browser.actions.EvasionMouse.human_click", new_callable=AsyncMock
    ) as mock_click:
        result = await submit_and_verify_post(page=mock_page, selectors=selectors)
        assert isinstance(result, XPostResult)
        assert result.success is True
        assert result.post_id == "1234567890"
        mock_click.assert_awaited_once()


@pytest.mark.anyio
async def test_modular_submit_and_verify_post_button_disabled() -> None:
    mock_btn = AsyncMock()
    mock_btn.count = AsyncMock(return_value=1)
    mock_btn.first = mock_btn
    mock_btn.is_visible = AsyncMock(return_value=True)
    mock_btn.is_enabled = AsyncMock(return_value=False)

    mock_page = AsyncMock()
    mock_page.locator = MagicMock(return_value=mock_btn)

    selectors = {"compose": {"post_button": "button[data-testid='tweetButtonInline']"}}

    result = await submit_and_verify_post(page=mock_page, selectors=selectors)
    assert result.success is False
    assert result.error == "Post button disabled or not clickable"
