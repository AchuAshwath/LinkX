import pytest
from langchain_openai import ChatOpenAI

from app.core.config import settings
from app.services.agentic.client import get_chat_model, get_vision_model


def test_get_chat_model_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "OPENAI_API_COMPATIBLE_API_KEY", "test-key")
    monkeypatch.setattr(
        settings, "OPENAI_API_COMPATIBLE_BASE_URL", "http://127.0.0.1:8317/v1"
    )

    model = get_chat_model(temperature=0.5, max_tokens=1000)

    expected_model = settings.AI_MODEL.removeprefix("openai/")
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == expected_model
    assert model.temperature in (0.5, None)
    assert model.max_tokens == 1000
    assert str(model.openai_api_base).rstrip("/") == "http://127.0.0.1:8317/v1"


def test_get_chat_model_override() -> None:
    model = get_chat_model(model="claude-sonnet-4-6", temperature=0.1)

    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "claude-sonnet-4-6"
    assert model.temperature == 0.1


def test_get_vision_model_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "OPENAI_API_COMPATIBLE_API_KEY", "test-key")
    monkeypatch.setattr(
        settings, "OPENAI_API_COMPATIBLE_BASE_URL", "http://127.0.0.1:8317/v1"
    )

    model = get_vision_model()

    expected_vision_model = settings.VISION_AI_MODEL.removeprefix("openai/")
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == expected_vision_model
    assert model.temperature in (0.2, None)
