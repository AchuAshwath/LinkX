"""AI Model Catalog Service.

Provides model discovery, filtering, friendly display names, and default
model resolution for LinkX chat and copilot features.
"""

from typing import Any

import httpx

from app.core.config import settings
from app.models import AIModelInfo, AIModelsPublic

FRIENDLY_MODEL_NAMES: dict[str, str] = {
    "gemini-3.7-flash-high": "Gemini 3.7 Flash",
    "gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
    "gemini-3-flash": "Gemini 3 Flash",
    "gemini-3.1-pro-low": "Gemini 3.1 Pro",
    "claude-sonnet-4-6": "Claude 3.7 Sonnet",
    "claude-opus-4-6-thinking": "Claude 3.7 Opus",
    "gpt-oss-120b-medium": "DeepSeek R1",
    "gpt-5.6-luna": "5.6 Luna",
    "gpt-5.6-sol": "5.6 Sol",
    "gpt-5.6-terra": "5.6 Terra",
    "gpt-5.5": "5.5",
    "gpt-5.4": "5.4",
    "gpt-6-astra": "6 Astra",
}

EXCLUDED_MODEL_PREFIXES = (
    "gpt-image-",
    "image-",
    "grok-imagine-",
    "dall-e-",
)

EXCLUDED_MODELS = {
    "gpt-5.3-codex-spark",
    "codex-auto-review",
}


def resolve_model_provider(*, model_id: str) -> str:
    """Resolve provider display name from model ID prefix."""
    mid = model_id.lower()
    if mid.startswith("gemini"):
        return "Google"
    if mid.startswith("claude"):
        return "Anthropic"
    if mid.startswith(("deepseek", "gpt-oss")):
        return "DeepSeek"
    if mid.startswith("qwen"):
        return "Qwen"
    if mid.startswith(("kimi", "moonshot")):
        return "Moonshot"
    if mid.startswith("grok"):
        return "xAI"
    return "OpenAI"


def resolve_model_name(*, model_id: str) -> str:
    """Resolve friendly display label for a model ID."""
    if model_id in FRIENDLY_MODEL_NAMES:
        return FRIENDLY_MODEL_NAMES[model_id]
    clean = model_id.removeprefix("gpt-").replace("-", " ")
    return clean.title()


def build_fallback_models(*, default_model_id: str) -> list[AIModelInfo]:
    """Generate fallback model list containing only the configured default."""
    if not default_model_id:
        return []
    return [
        AIModelInfo(
            id=default_model_id,
            name=resolve_model_name(model_id=default_model_id),
            provider=resolve_model_provider(model_id=default_model_id),
            is_default=True,
        )
    ]


def is_image_or_excluded_model(*, model_id: str) -> bool:
    """Check if model is an image generation model or specifically excluded."""
    mid = model_id.lower()
    if mid in EXCLUDED_MODELS:
        return True
    return mid.startswith(EXCLUDED_MODEL_PREFIXES)


def is_allowed_proxy_model(*, item: dict[str, Any], default_model_id: str) -> bool:
    """Determine if a raw proxy model entry should be exposed in chat."""
    raw_id = item.get("id")
    if not raw_id:
        return False
    model_id = str(raw_id)
    if model_id == default_model_id:
        return True
    return not is_image_or_excluded_model(model_id=model_id)


def fetch_models_from_proxy(*, default_model_id: str) -> list[AIModelInfo]:
    """Fetch and filter available models from the OpenAI-compatible proxy."""
    api_key = (
        settings.OPENAI_API_COMPATIBLE_API_KEY or settings.AI_API_KEY or "dummy-key"
    )
    with httpx.Client(timeout=3.0) as client:
        resp = client.get(
            f"{settings.AI_API_BASE}/models",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if resp.status_code != 200:
            return []
        items = resp.json().get("data", [])
        return [
            AIModelInfo(
                id=str(item["id"]),
                name=resolve_model_name(model_id=str(item["id"])),
                provider=resolve_model_provider(model_id=str(item["id"])),
                is_default=(str(item["id"]) == default_model_id),
            )
            for item in items
            if is_allowed_proxy_model(item=item, default_model_id=default_model_id)
        ]


def ensure_default_model_present(
    *, models: list[AIModelInfo], default_model_id: str
) -> list[AIModelInfo]:
    """Ensure configured default model exists in the list even if proxy omitted it."""
    if not default_model_id:
        return models
    if any(m.id == default_model_id for m in models):
        return models
    default_entry = AIModelInfo(
        id=default_model_id,
        name=resolve_model_name(model_id=default_model_id),
        provider=resolve_model_provider(model_id=default_model_id),
        is_default=True,
    )
    return [default_entry, *models]


def sort_models_with_default_first(
    *, models: list[AIModelInfo], default_model_id: str
) -> list[AIModelInfo]:
    """Sort models placing the active default model at index 0."""
    defaults = [m for m in models if m.id == default_model_id]
    others = [m for m in models if m.id != default_model_id]
    return [*defaults, *others]


def resolve_default_model_id(
    *, models: list[AIModelInfo], preferred_default_id: str
) -> str:
    """Resolve the effective default model ID."""
    if any(m.id == preferred_default_id for m in models):
        return preferred_default_id
    if models:
        return models[0].id
    return preferred_default_id


def mark_default_model(
    *, models: list[AIModelInfo], default_model_id: str
) -> list[AIModelInfo]:
    """Return model list with the is_default flag updated for the selected default."""
    return [
        AIModelInfo(
            id=m.id,
            name=m.name,
            provider=m.provider,
            is_default=(m.id == default_model_id),
        )
        for m in models
    ]


def get_available_ai_models(*, configured_default: str) -> AIModelsPublic:
    """Retrieve filtered, sorted AI models with default guaranteed present."""
    try:
        raw_models = fetch_models_from_proxy(default_model_id=configured_default)
        if raw_models:
            with_default = ensure_default_model_present(
                models=raw_models, default_model_id=configured_default
            )
            resolved_default = resolve_default_model_id(
                models=with_default, preferred_default_id=configured_default
            )
            final_models = mark_default_model(
                models=with_default, default_model_id=resolved_default
            )
            ordered_models = sort_models_with_default_first(
                models=final_models, default_model_id=resolved_default
            )
            return AIModelsPublic(data=ordered_models, default_model=resolved_default)
    except Exception:
        pass
    fallback = build_fallback_models(default_model_id=configured_default)
    return AIModelsPublic(data=fallback, default_model=configured_default)
