"""Unit tests for AI Model Catalog Service."""

from unittest.mock import MagicMock, patch

from app.models import AIModelInfo
from app.services.ai_model_catalog import (
    build_fallback_models,
    ensure_default_model_present,
    get_available_ai_models,
    is_allowed_proxy_model,
    is_image_or_excluded_model,
    mark_default_model,
    resolve_default_model_id,
    resolve_model_name,
    resolve_model_provider,
    sort_models_with_default_first,
)


def test_is_image_or_excluded_model() -> None:
    assert is_image_or_excluded_model(model_id="gpt-image-2.5-flare") is True
    assert is_image_or_excluded_model(model_id="gpt-image-2") is True
    assert is_image_or_excluded_model(model_id="image-generator-pro") is True
    assert is_image_or_excluded_model(model_id="grok-imagine-1") is True
    assert is_image_or_excluded_model(model_id="dall-e-3") is True
    assert is_image_or_excluded_model(model_id="codex-auto-review") is True
    assert is_image_or_excluded_model(model_id="gpt-5.3-codex-spark") is True

    # Chat models should not be excluded
    assert is_image_or_excluded_model(model_id="gpt-5.6-luna") is False
    assert is_image_or_excluded_model(model_id="gpt-6-astra") is False
    assert is_image_or_excluded_model(model_id="claude-sonnet-4-6") is False


def test_is_allowed_proxy_model() -> None:
    assert (
        is_allowed_proxy_model(
            item={"id": "gpt-image-2.5"}, default_model_id="gpt-5.6-luna"
        )
        is False
    )
    assert is_allowed_proxy_model(item={}, default_model_id="gpt-5.6-luna") is False
    assert (
        is_allowed_proxy_model(
            item={"id": "gpt-6-astra"}, default_model_id="gpt-5.6-luna"
        )
        is True
    )
    # Default model is always allowed
    assert (
        is_allowed_proxy_model(
            item={"id": "gpt-5.6-luna"}, default_model_id="gpt-5.6-luna"
        )
        is True
    )


def test_resolve_model_provider() -> None:
    assert resolve_model_provider(model_id="gemini-3.7-flash") == "Google"
    assert resolve_model_provider(model_id="claude-sonnet-4-6") == "Anthropic"
    assert resolve_model_provider(model_id="deepseek-coder") == "DeepSeek"
    assert resolve_model_provider(model_id="gpt-oss-120b") == "DeepSeek"
    assert resolve_model_provider(model_id="qwen-2.5-coder") == "Qwen"
    assert resolve_model_provider(model_id="kimi-k2") == "Moonshot"
    assert resolve_model_provider(model_id="grok-4") == "xAI"
    assert resolve_model_provider(model_id="gpt-5.6-luna") == "OpenAI"


def test_resolve_model_name() -> None:
    assert resolve_model_name(model_id="gpt-5.6-luna") == "5.6 Luna"
    assert resolve_model_name(model_id="gpt-6-astra") == "6 Astra"
    assert resolve_model_name(model_id="gpt-custom-model") == "Custom Model"


def test_build_fallback_models() -> None:
    assert build_fallback_models(default_model_id="") == []
    models = build_fallback_models(default_model_id="gpt-5.6-luna")
    assert len(models) == 1
    assert models[0].id == "gpt-5.6-luna"
    assert models[0].name == "5.6 Luna"
    assert models[0].is_default is True


def test_ensure_default_model_present() -> None:
    existing = [
        AIModelInfo(
            id="gpt-6-astra", name="6 Astra", provider="OpenAI", is_default=False
        )
    ]
    # Injects missing default
    updated = ensure_default_model_present(
        models=existing, default_model_id="gpt-5.6-luna"
    )
    assert len(updated) == 2
    assert updated[0].id == "gpt-5.6-luna"

    # Does not duplicate if already present
    no_dup = ensure_default_model_present(
        models=updated, default_model_id="gpt-5.6-luna"
    )
    assert len(no_dup) == 2


def test_sort_models_with_default_first() -> None:
    models = [
        AIModelInfo(
            id="gpt-6-astra", name="6 Astra", provider="OpenAI", is_default=False
        ),
        AIModelInfo(
            id="gpt-5.6-luna", name="5.6 Luna", provider="OpenAI", is_default=True
        ),
        AIModelInfo(id="gpt-5.5", name="5.5", provider="OpenAI", is_default=False),
    ]
    sorted_models = sort_models_with_default_first(
        models=models, default_model_id="gpt-5.6-luna"
    )
    assert sorted_models[0].id == "gpt-5.6-luna"
    assert [m.id for m in sorted_models] == ["gpt-5.6-luna", "gpt-6-astra", "gpt-5.5"]


def test_resolve_default_model_id() -> None:
    models = [
        AIModelInfo(
            id="gpt-6-astra", name="6 Astra", provider="OpenAI", is_default=False
        ),
        AIModelInfo(id="gpt-5.5", name="5.5", provider="OpenAI", is_default=False),
    ]
    # Falls back to first model if preferred is missing
    assert (
        resolve_default_model_id(models=models, preferred_default_id="unknown")
        == "gpt-6-astra"
    )
    # Returns preferred if present
    assert (
        resolve_default_model_id(models=models, preferred_default_id="gpt-5.5")
        == "gpt-5.5"
    )


def test_mark_default_model() -> None:
    models = [
        AIModelInfo(
            id="gpt-6-astra", name="6 Astra", provider="OpenAI", is_default=True
        ),
        AIModelInfo(id="gpt-5.5", name="5.5", provider="OpenAI", is_default=False),
    ]
    marked = mark_default_model(models=models, default_model_id="gpt-5.5")
    assert marked[0].is_default is False
    assert marked[1].is_default is True


def test_get_available_ai_models_filters_and_guarantees_default() -> None:
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "data": [
            {"id": "gpt-image-2.5-flare"},
            {"id": "gpt-6-astra"},
            {"id": "gpt-image-2.5"},
            {"id": "gpt-5.5"},
        ]
    }

    with patch("httpx.Client.get", return_value=mock_resp):
        result = get_available_ai_models(configured_default="gpt-5.6-luna")

    # Image models are removed
    ids = [m.id for m in result.data]
    assert "gpt-image-2.5-flare" not in ids
    assert "gpt-image-2.5" not in ids
    # Default model is injected and placed first
    assert result.default_model == "gpt-5.6-luna"
    assert ids[0] == "gpt-5.6-luna"
    assert result.data[0].is_default is True
    # Other valid models remain
    assert "gpt-6-astra" in ids
    assert "gpt-5.5" in ids
