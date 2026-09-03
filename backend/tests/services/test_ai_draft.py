from unittest.mock import AsyncMock, patch

import pytest

from app.core.config import settings
from app.services.ai_draft import _resolve_ai_credentials, generate_ai_post_draft


def test_resolve_ai_credentials_from_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "OPENAI_API_COMPATIBLE_API_KEY", "test-key-123")
    monkeypatch.setattr(
        settings, "OPENAI_API_COMPATIBLE_BASE_URL", "http://test-base:8317/v1"
    )
    monkeypatch.setattr(settings, "AI_MODEL", "openai/test-model")

    api_key, api_base, model = _resolve_ai_credentials()
    assert api_key == "test-key-123"
    assert api_base == "http://test-base:8317/v1"
    assert model == "openai/test-model"


def test_resolve_ai_credentials_when_key_is_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "OPENAI_API_COMPATIBLE_API_KEY", None)
    monkeypatch.setattr(settings, "AI_API_KEY", None)
    monkeypatch.delenv("OPENAI_API_COMPATIBLE_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(
        settings, "OPENAI_API_COMPATIBLE_BASE_URL", "http://127.0.0.1:8317/v1"
    )
    api_key, api_base, model = _resolve_ai_credentials()
    assert api_key is None
    assert api_base == "http://127.0.0.1:8317/v1"
    assert model == settings.AI_MODEL


@pytest.mark.anyio
async def test_generate_ai_post_draft_with_litellm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "OPENAI_API_COMPATIBLE_API_KEY", "test-key-123")
    monkeypatch.setattr(
        settings, "OPENAI_API_COMPATIBLE_BASE_URL", "http://test-base:8317/v1"
    )
    monkeypatch.setattr(settings, "AI_MODEL", "openai/test-model")

    mock_choice = AsyncMock()
    mock_choice.message.content = "AI Generated Post Content"
    mock_response = AsyncMock()
    mock_response.choices = [mock_choice]

    with patch("litellm.acompletion", new_callable=AsyncMock) as mock_acompletion:
        mock_acompletion.return_value = mock_response

        content = await generate_ai_post_draft(
            prompt="Deep Learning", platform="x", tone="bold"
        )

        assert content == "AI Generated Post Content"
        mock_acompletion.assert_awaited_once()
        call_kwargs = mock_acompletion.call_args.kwargs
        assert call_kwargs["model"] == "openai/test-model"
        assert call_kwargs["api_key"] == "test-key-123"
        assert call_kwargs["api_base"] == "http://test-base:8317/v1"


@pytest.mark.anyio
async def test_generate_ai_post_draft_with_custom_model_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "OPENAI_API_COMPATIBLE_API_KEY", "test-key-123")
    monkeypatch.setattr(settings, "AI_MODEL", "openai/default-model")

    mock_choice = AsyncMock()
    mock_choice.message.content = "Custom Model Output"
    mock_response = AsyncMock()
    mock_response.choices = [mock_choice]

    with patch("litellm.acompletion", new_callable=AsyncMock) as mock_acompletion:
        mock_acompletion.return_value = mock_response

        content = await generate_ai_post_draft(
            prompt="Prompt", model="openai/test-override-model"
        )

        assert content == "Custom Model Output"
        assert (
            mock_acompletion.call_args.kwargs["model"] == "openai/test-override-model"
        )


@pytest.mark.anyio
async def test_generate_ai_post_draft_fallback_on_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "OPENAI_API_COMPATIBLE_API_KEY", "test-key-123")

    with patch("litellm.acompletion", new_callable=AsyncMock) as mock_acompletion:
        mock_acompletion.side_effect = RuntimeError("Proxy unavailable")

        content = await generate_ai_post_draft(prompt="System Design", platform="x")

        assert "System Design" in content
        assert "#Tech" in content or "#BuildInPublic" in content
