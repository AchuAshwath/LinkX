import asyncio
import json
import re
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

LINKX_SYSTEM_PROMPT = """You are LinkX Copilot — an expert social media strategist, copywriter, and viral growth advisor.
You help users craft high-performing, engaging posts for LinkedIn, X (Twitter), and cross-platform growth.

Your capabilities:
- Draft compelling hooks, thought leadership articles, and viral thread openers.
- Rewrite and refine drafts for clarity, punchiness, engagement, and platform fit.
- Suggest strategic hashtags, strong calls-to-action (CTAs), and formatting improvements.
- Advise on posting strategy, timing, tone of voice, and audience engagement.
- Answer questions about social media growth and content strategy.

Guidelines:
- First, briefly outline your strategic thinking, angle, and platform tone inside <thought>...</thought> tags.
- Then, provide your final response or post content cleanly outside the tags.
- Format responses cleanly with Markdown, clear paragraph breaks, and bullet points where helpful.
- Respect platform constraints (X: 280 chars or 25,000 for Premium; LinkedIn: up to 3,000 chars).
"""

OPEN_THOUGHT_RE = re.compile(
    r"<(?:thought|thinking|think)(?:>|[\s\n\r>])", re.IGNORECASE
)
CLOSE_THOUGHT_RE = re.compile(r"</(?:thought|thinking|think)>?", re.IGNORECASE)


def format_sse(*, event: str, data: dict[str, Any]) -> str:
    """Format an SSE event string according to the SSE standard."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _extract_text_from_parts(parts: list[dict[str, Any]]) -> str:
    """Extract concatenated text content from message parts."""
    text_chunks = [
        str(part.get("text", ""))
        for part in parts
        if part.get("type") == "text" and part.get("text")
    ]
    return "\n".join(text_chunks).strip()


def _build_message_history(
    *,
    transcript: dict[str, Any] | None,
    current_message: str,
    max_history_messages: int = 40,
) -> list[BaseMessage]:
    """Convert JSONB transcript messages into LangChain BaseMessage objects."""
    messages: list[BaseMessage] = [SystemMessage(content=LINKX_SYSTEM_PROMPT)]
    raw_messages = (transcript or {}).get("messages", [])

    converted: list[BaseMessage] = []
    for item in raw_messages:
        role = item.get("role")
        parts = item.get("parts", [])
        text = _extract_text_from_parts(parts)
        if not text:
            continue
        if role == "user":
            converted.append(HumanMessage(content=text))
        elif role == "assistant":
            converted.append(AIMessage(content=text))

    if (
        not converted
        or not isinstance(converted[-1], HumanMessage)
        or converted[-1].content != current_message
    ):
        converted.append(HumanMessage(content=current_message))

    if len(converted) > max_history_messages:
        converted = converted[-max_history_messages:]

    messages.extend(converted)
    return messages


async def _stream_text_smoothly(
    text: str,
    *,
    event_type: str = "text_delta",
    delay: float = 0.015,
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    """Yield deltas smoothly word-by-word preserving whitespace and formatting."""
    tokens = re.findall(r"\S+\s*|\s+", text)
    if not tokens:
        if text:
            yield (event_type, {"content": text})
        return

    for token in tokens:
        yield (event_type, {"content": token})
        if delay > 0:
            await asyncio.sleep(delay)


async def _stream_parsed_chunks(
    raw_chunks: AsyncGenerator[str, None],
    *,
    delay: float = 0.015,
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    """Parse streaming raw LLM tokens for <thought> tags and route to thought or text_delta events."""
    in_thought = False
    buffer = ""

    async for chunk in raw_chunks:
        buffer += chunk
        while buffer:
            if not in_thought:
                m_open = OPEN_THOUGHT_RE.search(buffer)
                if m_open:
                    prefix = buffer[: m_open.start()]
                    if prefix:
                        async for ev in _stream_text_smoothly(
                            prefix, event_type="text_delta", delay=delay
                        ):
                            yield ev
                    in_thought = True
                    buffer = buffer[m_open.end() :]
                elif "<" in buffer and len(buffer) - buffer.rfind("<") < 12:
                    safe = buffer[: buffer.rfind("<")]
                    if safe:
                        async for ev in _stream_text_smoothly(
                            safe, event_type="text_delta", delay=delay
                        ):
                            yield ev
                        buffer = buffer[len(safe) :]
                    break
                else:
                    async for ev in _stream_text_smoothly(
                        buffer, event_type="text_delta", delay=delay
                    ):
                        yield ev
                    buffer = ""
            else:
                m_close = CLOSE_THOUGHT_RE.search(buffer)
                if m_close:
                    thought = buffer[: m_close.start()]
                    if thought:
                        async for ev in _stream_text_smoothly(
                            thought, event_type="thought", delay=delay
                        ):
                            yield ev
                    in_thought = False
                    buffer = buffer[m_close.end() :].lstrip("\n")
                elif "<" in buffer and len(buffer) - buffer.rfind("<") < 15:
                    safe = buffer[: buffer.rfind("<")]
                    if safe:
                        async for ev in _stream_text_smoothly(
                            safe, event_type="thought", delay=delay
                        ):
                            yield ev
                        buffer = buffer[len(safe) :]
                    break
                else:
                    async for ev in _stream_text_smoothly(
                        buffer, event_type="thought", delay=delay
                    ):
                        yield ev
                    buffer = ""

    if buffer:
        event_type = "thought" if in_thought else "text_delta"
        async for ev in _stream_text_smoothly(
            buffer, event_type=event_type, delay=delay
        ):
            yield ev


def _format_messages_for_openai(
    messages: list[BaseMessage],
) -> list[dict[str, str]]:
    formatted: list[dict[str, str]] = []
    for msg in messages:
        if isinstance(msg, SystemMessage):
            formatted.append({"role": "system", "content": str(msg.content)})
        elif isinstance(msg, HumanMessage):
            formatted.append({"role": "user", "content": str(msg.content)})
        elif isinstance(msg, AIMessage):
            formatted.append({"role": "assistant", "content": str(msg.content)})
    return formatted


async def _stream_direct_openai_proxy(
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
                if not line.startswith("data: ") or line == "data: [DONE]":
                    continue
                try:
                    data = json.loads(line[6:])
                    delta = data.get("choices", [{}])[0].get("delta", {})
                    reasoning = (
                        delta.get("reasoning_content")
                        or delta.get("reasoning")
                        or delta.get("thought")
                    )
                    content = delta.get("content")
                    if reasoning and isinstance(reasoning, str):
                        yield f"<thought>{reasoning}</thought>"
                    if content and isinstance(content, str):
                        yield content
                except Exception:
                    continue


async def stream_raw_chat_completion(
    *,
    messages: list[BaseMessage],
    model: str | None = None,
) -> AsyncGenerator[str, None]:
    """Stream raw text tokens including reasoning/thought tags from proxy or ChatOpenAI model."""
    target_model = model or settings.AI_MODEL
    try:
        formatted_msgs = _format_messages_for_openai(messages)
        streamed_anything = False
        async for token in _stream_direct_openai_proxy(
            messages=formatted_msgs,
            model_name=target_model,
            temperature=0.7,
            max_tokens=2000,
        ):
            streamed_anything = True
            yield token
        if streamed_anything:
            return
    except Exception:
        pass

    # Fallback to LangChain model client (useful for mocks and custom test runners)
    chat_model = get_chat_model(
        model=target_model,
        temperature=0.7,
        max_tokens=2000,
        streaming=True,
    )
    async for chunk in chat_model.astream(messages):
        reasoning = chunk.additional_kwargs.get(
            "reasoning_content"
        ) or chunk.additional_kwargs.get("thought")
        if reasoning and isinstance(reasoning, str):
            yield f"<thought>{reasoning}</thought>"

        text = chunk.content
        if isinstance(text, str) and text:
            yield text
        elif isinstance(text, list):
            combined = "".join(str(c) for c in text if c)
            if combined:
                yield combined


async def default_chat_stream_runner(
    *,
    message: str,
    thread_id: str,  # noqa: ARG001
    transcript: dict[str, Any] | None = None,
    smooth_delay: float = 0.015,
    model: str | None = None,
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    """Stream AI chat conversation tokens and thinking thoughts word-by-word."""
    messages = _build_message_history(
        transcript=transcript,
        current_message=message,
    )

    try:
        async for event in _stream_parsed_chunks(
            stream_raw_chat_completion(messages=messages, model=model),
            delay=smooth_delay,
        ):
            yield event

    except Exception as exc:
        yield ("error", {"message": f"LLM error: {exc}"})

    yield ("done", {})
