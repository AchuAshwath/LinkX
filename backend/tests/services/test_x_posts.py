import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from rebrowser_playwright.async_api import TimeoutError as PlaywrightTimeoutError

from app.services.browser.actions import PostButtonDisabledError
from app.services.x_posts import XPostClient, XPostError, XPostResult


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_validate_content_length_exceeded(tmp_path: Path) -> None:
    client = XPostClient()
    dummy_file = tmp_path / "test.png"
    dummy_file.write_bytes(b"test")

    with pytest.raises(XPostError) as exc_info:
        await client.create_media_post(
            content="A" * 281,
            image_path=str(dummy_file),
            user_id="user_123",
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "x_content_too_long"


@pytest.mark.anyio
async def test_create_media_post_missing_image_file() -> None:
    client = XPostClient()
    with pytest.raises(XPostError) as exc_info:
        await client.create_media_post(
            content="Hello world",
            image_path="/non/existent/path/image.png",
            user_id="user_123",
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "x_image_not_found"


@pytest.mark.anyio
async def test_create_media_post_no_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = XPostClient()
    dummy_file = tmp_path / "test.png"
    dummy_file.write_bytes(b"test")

    monkeypatch.setattr(
        "app.services.browser.manager.BrowserManager.session_exists",
        lambda _self, _platform: False,
    )

    with pytest.raises(XPostError) as exc_info:
        await client.create_media_post(
            content="Hello world",
            image_path=str(dummy_file),
            user_id="user_123",
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "x_not_connected"


def _setup_mock_browser_environment(
    monkeypatch: pytest.MonkeyPatch,
    *,
    mock_expect_response_fn: Any = None,
    mock_wait_for_selector_fn: Any = None,
) -> AsyncMock:
    monkeypatch.setattr(
        "app.services.browser.manager.BrowserManager.session_exists",
        lambda _self, _platform: True,
    )

    mock_locator = AsyncMock()
    mock_locator.set_input_files = AsyncMock()
    mock_locator.scroll_into_view_if_needed = AsyncMock()
    mock_locator.bounding_box = AsyncMock(
        return_value={"x": 100, "y": 100, "width": 50, "height": 30}
    )
    mock_locator.click = AsyncMock()
    mock_locator.first = mock_locator

    mock_page = AsyncMock()
    mock_page.viewport_size = {"width": 1280, "height": 800}
    mock_page.mouse = AsyncMock()
    mock_page.inner_text = AsyncMock(return_value="Home feed content")
    mock_page.url = "https://x.com/home"
    mock_page.goto = AsyncMock()
    mock_page.wait_for_url = AsyncMock()
    mock_page.wait_for_selector = mock_wait_for_selector_fn or AsyncMock()
    mock_page.locator = MagicMock(return_value=mock_locator)
    if mock_expect_response_fn:
        mock_page.expect_response = mock_expect_response_fn

    mock_context = AsyncMock()
    mock_context.pages = [mock_page]

    @asynccontextmanager
    async def mock_get_context(*_args: Any, **_kwargs: Any) -> Any:
        yield mock_context

    monkeypatch.setattr(
        "app.services.browser.manager.BrowserManager.get_context",
        mock_get_context,
    )
    monkeypatch.setattr(
        "app.services.browser.actions.random_delay",
        AsyncMock(),
    )
    monkeypatch.setattr(
        "app.services.x_posts.random_delay",
        AsyncMock(),
    )
    monkeypatch.setattr(
        "app.services.browser.actions.HumanTyper.type",
        AsyncMock(),
    )
    return mock_locator


@pytest.mark.anyio
async def test_create_media_post_success(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = XPostClient()
    dummy_file = tmp_path / "test.png"
    dummy_file.write_bytes(b"test image data")

    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.json = AsyncMock(
        return_value={
            "data": {
                "create_tweet": {
                    "tweet_results": {"result": {"rest_id": "18928374619283"}}
                }
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

    mock_locator = _setup_mock_browser_environment(
        monkeypatch,
        mock_expect_response_fn=mock_expect_response,
    )

    result = await client.create_media_post(
        content="Testing Playwright media automation!",
        image_path=str(dummy_file),
        user_id="test_user",
        headless=True,
    )

    assert isinstance(result, XPostResult)
    assert result.success is True
    assert result.post_id == "18928374619283"
    assert result.post_url == "https://x.com/i/status/18928374619283"
    mock_locator.set_input_files.assert_awaited_once_with(str(dummy_file.resolve()))


@pytest.mark.anyio
async def test_create_media_post_attachment_timeout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = XPostClient()
    dummy_file = tmp_path / "test.png"
    dummy_file.write_bytes(b"test image data")

    async def mock_wait_for_selector(selector: str, *_args: Any, **_kwargs: Any) -> Any:
        if "attachments" in selector:
            raise PlaywrightTimeoutError("Attachment timed out")
        return None

    _setup_mock_browser_environment(
        monkeypatch,
        mock_wait_for_selector_fn=mock_wait_for_selector,
    )

    with pytest.raises(XPostError) as exc_info:
        await client.create_media_post(
            content="Testing media timeout",
            image_path=str(dummy_file),
            user_id="test_user",
        )

    assert exc_info.value.status_code == 504
    assert exc_info.value.code == "x_media_upload_timeout"


@pytest.mark.anyio
async def test_create_media_post_button_disabled(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = XPostClient()
    dummy_file = tmp_path / "test.png"
    dummy_file.write_bytes(b"test image data")

    @asynccontextmanager
    async def mock_expect_response(*_args: Any, **_kwargs: Any) -> Any:
        yield MagicMock()

    _setup_mock_browser_environment(
        monkeypatch,
        mock_expect_response_fn=mock_expect_response,
    )

    async def mock_human_click(*_args: Any, **kwargs: Any) -> None:
        selector = kwargs.get("selector", "")
        if "tweetButtonInline" in selector:
            raise PostButtonDisabledError("Button disabled")

    monkeypatch.setattr(
        "app.services.browser.actions.EvasionMouse.human_click",
        mock_human_click,
    )

    with pytest.raises(XPostError) as exc_info:
        await client.create_media_post(
            content="Testing disabled button",
            image_path=str(dummy_file),
            user_id="test_user",
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "x_button_disabled"
