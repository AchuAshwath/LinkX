import json
from collections.abc import AsyncGenerator
from typing import Any

import httpx
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
)

from app.core.config import settings
from app.services.agentic.client import get_chat_model

MESSAGE_ROLE_MAP: dict[type[BaseMessage], str] = {
    SystemMessage: "system",
    HumanMessage: "user",
    AIMessage: "assistant",
}


def format_messages_for_openai(
    messages: list[BaseMessage],
) -> list[dict[str, str]]:
    """Format LangChain BaseMessage objects into OpenAI messages format."""
    return [
        {"role": role, "content": str(msg.content)}
        for msg in messages
        if (role := MESSAGE_ROLE_MAP.get(type(msg))) is not None
    ]


def _extract_reasoning(data: dict[str, Any]) -> str | None:
    for key in ("reasoning_content", "reasoning", "thought"):
        val = data.get(key)
        if isinstance(val, str) and val:
            return val
    return None


def extract_chunk_content(delta: dict[str, Any]) -> str | None:
    """Extract text or thought from OpenAI streaming chunk delta."""
    reasoning = _extract_reasoning(delta)
    if reasoning:
        return f"<thought>{reasoning}</thought>"
    content = delta.get("content")
    return str(content) if isinstance(content, str) and content else None


def parse_sse_line(line: str) -> str | None:
    """Parse a single SSE data line from OpenAI-compatible chat stream."""
    if not line.startswith("data: ") or line == "data: [DONE]":
        return None
    try:
        data = json.loads(line[6:])
        choices = data.get("choices", [])
        if choices:
            return extract_chunk_content(choices[0].get("delta", {}))
    except (json.JSONDecodeError, KeyError, IndexError):
        pass
    return None


async def stream_direct_openai_proxy(
    *,
    messages: list[dict[str, str]],
    model_name: str,
    temperature: float = 0.7,
    max_tokens: int = 2000,
) -> AsyncGenerator[str, None]:
    """Stream raw tokens and thinking tags directly from OpenAI-compatible proxy."""
    api_key = (
        settings.OPENAI_API_COMPATIBLE_API_KEY or settings.AI_API_KEY or "dummy-key"
    )
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_name.removeprefix("openai/"),
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    async with httpx.AsyncClient(timeout=45.0) as client:
        async with client.stream(
            "POST",
            f"{settings.AI_API_BASE}/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            if response.status_code != 200:
                err_body = await response.aread()
                raise RuntimeError(
                    f"Proxy HTTP {response.status_code}: {err_body.decode('utf-8', errors='ignore')}"
                )

            async for line in response.aiter_lines():
                parsed = parse_sse_line(line)
                if parsed:
                    yield parsed


def extract_langchain_chunk_text(chunk: Any) -> str | None:
    """Extract string content from LangChain stream chunk."""
    text = chunk.content
    if isinstance(text, str):
        return text or None
    if isinstance(text, list):
        return "".join(str(c) for c in text if c) or None
    return None


def _extract_langchain_reasoning(chunk: Any) -> str | None:
    kwargs = chunk.additional_kwargs or {}
    return _extract_reasoning(kwargs)


async def stream_fallback_langchain(
    messages: list[BaseMessage], target_model: str
) -> AsyncGenerator[str, None]:
    """Fallback streaming via LangChain chat model wrapper."""
    chat_model = get_chat_model(
        model=target_model,
        temperature=0.7,
        max_tokens=2000,
        streaming=True,
    )
    async for chunk in chat_model.astream(messages):
        reasoning = _extract_langchain_reasoning(chunk)
        if reasoning:
            yield f"<thought>{reasoning}</thought>"

        text = extract_langchain_chunk_text(chunk)
        if text:
            yield text


async def stream_raw_chat_completion(
    *,
    messages: list[BaseMessage],
    model: str | None = None,
) -> AsyncGenerator[str, None]:
    """Stream raw text tokens including reasoning/thought tags from proxy or ChatOpenAI model."""
    target_model = model or settings.AI_MODEL
    try:
        formatted_msgs = format_messages_for_openai(messages)
        streamed = False
        async for token in stream_direct_openai_proxy(
            messages=formatted_msgs,
            model_name=target_model,
            temperature=0.7,
            max_tokens=2000,
        ):
            streamed = True
            yield token
        if streamed:
            return
    except Exception:
        pass

    async for token in stream_fallback_langchain(messages, target_model):
        yield token
