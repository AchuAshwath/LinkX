"""LangChain Chat and Vision Model factory configured for OpenAI-compatible CLIProxyAPI."""

from __future__ import annotations

from langchain_openai import ChatOpenAI

from app.core.config import settings


def get_chat_model(
    *,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int | None = 1500,
) -> ChatOpenAI:
    """Create a configured ChatOpenAI instance for text generation and reasoning."""
    target_model = model or settings.AI_MODEL
    # Strip optional provider prefix like 'openai/' if present for standard OpenAI client
    clean_model = target_model.removeprefix("openai/")

    return ChatOpenAI(
        model=clean_model,
        base_url=settings.OPENAI_API_COMPATIBLE_BASE_URL,
        api_key=(settings.OPENAI_API_COMPATIBLE_API_KEY or "dummy-key"),  # type: ignore[arg-type]
        temperature=temperature,
        max_completion_tokens=max_tokens,
    )


def get_vision_model(
    *,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int | None = 2000,
) -> ChatOpenAI:
    """Create a configured ChatOpenAI instance for visual comprehension and OCR extraction."""
    target_model = model or settings.VISION_AI_MODEL
    clean_model = target_model.removeprefix("openai/")

    return ChatOpenAI(
        model=clean_model,
        base_url=settings.OPENAI_API_COMPATIBLE_BASE_URL,
        api_key=(settings.OPENAI_API_COMPATIBLE_API_KEY or "dummy-key"),  # type: ignore[arg-type]
        temperature=temperature,
        max_completion_tokens=max_tokens,
    )
