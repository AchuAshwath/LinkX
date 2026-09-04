"""LangChain Chat and Vision Model factory configured for OpenAI-compatible CLIProxyAPI."""

from __future__ import annotations

from langchain_openai import ChatOpenAI

from app.core.config import settings


def get_chat_model(
    *,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int | None = 1500,
    streaming: bool = True,
) -> ChatOpenAI:
    """Create a configured ChatOpenAI instance for text generation and reasoning."""
    target_model = model or settings.AI_MODEL
    # Strip optional provider prefix like 'openai/' if present for standard OpenAI client
    clean_model = target_model.removeprefix("openai/")
    if clean_model.startswith("gemini"):
        clean_model = "gpt-5.4"
    resolved_api_key = (
        settings.OPENAI_API_COMPATIBLE_API_KEY or settings.AI_API_KEY or "dummy-key"
    )

    return ChatOpenAI(
        model=clean_model,
        base_url=settings.OPENAI_API_COMPATIBLE_BASE_URL,
        api_key=resolved_api_key,  # type: ignore[arg-type]
        temperature=temperature,
        max_completion_tokens=max_tokens,
        streaming=streaming,
    )


def get_vision_model(
    *,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int | None = 2000,
    streaming: bool = False,
) -> ChatOpenAI:
    """Create a configured ChatOpenAI instance for visual comprehension and OCR extraction."""
    target_model = model or settings.VISION_AI_MODEL
    clean_model = target_model.removeprefix("openai/")
    resolved_api_key = (
        settings.OPENAI_API_COMPATIBLE_API_KEY or settings.AI_API_KEY or "dummy-key"
    )

    return ChatOpenAI(
        model=clean_model,
        base_url=settings.OPENAI_API_COMPATIBLE_BASE_URL,
        api_key=resolved_api_key,  # type: ignore[arg-type]
        temperature=temperature,
        max_completion_tokens=max_tokens,
        streaming=streaming,
    )
