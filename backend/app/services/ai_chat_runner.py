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


def _consume_tag_buffer(
    buffer: str,
    tag_regex: re.Pattern[str],
    max_partial_len: int,
    *,
    next_in_thought: bool,
) -> tuple[str, bool, str, bool]:
    """Parse text against tag pattern with partial lookahead. Returns (emitted, is_partial, remainder, in_thought)."""
    m = tag_regex.search(buffer)
    if m:
        emitted = buffer[: m.start()]
        remainder = buffer[m.end() :]
        if not next_in_thought:
            remainder = remainder.lstrip("\n")
        return emitted, False, remainder, next_in_thought

    last_lt = buffer.rfind("<")
    if last_lt != -1 and len(buffer) - last_lt < max_partial_len:
        return buffer[:last_lt], True, buffer[last_lt:], not next_in_thought

    return buffer, False, "", not next_in_thought


def _consume_outside_thought(buffer: str) -> tuple[str, bool, str, bool]:
    """Parse text outside <thought> tags."""
    return _consume_tag_buffer(buffer, OPEN_THOUGHT_RE, 12, next_in_thought=True)


def _consume_inside_thought(buffer: str) -> tuple[str, bool, str, bool]:
    """Parse text inside <thought> tags."""
    return _consume_tag_buffer(buffer, CLOSE_THOUGHT_RE, 15, next_in_thought=False)


def _process_buffer_step(
    buffer: str, in_thought: bool
) -> tuple[str, bool, str, bool, str]:
    """Process one buffer step. Returns (emitted, is_partial, next_buffer, next_in_thought, event_type)."""
    event_type = "thought" if in_thought else "text_delta"
    if not in_thought:
        emitted, is_partial, next_buf, next_state = _consume_outside_thought(buffer)
    else:
        emitted, is_partial, next_buf, next_state = _consume_inside_thought(buffer)
    return emitted, is_partial, next_buf, next_state, event_type


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
            emitted, is_partial, buffer, in_thought, event_type = _process_buffer_step(
                buffer, in_thought
            )
            if emitted:
                async for ev in _stream_text_smoothly(
                    emitted, event_type=event_type, delay=delay
                ):
                    yield ev
            if is_partial:
                break

    if buffer:
        final_event = "thought" if in_thought else "text_delta"
        async for ev in _stream_text_smoothly(
            buffer, event_type=final_event, delay=delay
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


def _extract_chunk_content(delta: dict[str, Any]) -> str | None:
    reasoning = (
        delta.get("reasoning_content") or delta.get("reasoning") or delta.get("thought")
    )
    if isinstance(reasoning, str) and reasoning:
        return f"<thought>{reasoning}</thought>"
    content = delta.get("content")
    if isinstance(content, str) and content:
        return content
    return None


def _parse_sse_line(line: str) -> str | None:
    if not line.startswith("data: ") or line == "data: [DONE]":
        return None
    try:
        data = json.loads(line[6:])
        choices = data.get("choices", [])
        if choices:
            return _extract_chunk_content(choices[0].get("delta", {}))
    except Exception:
        pass
    return None


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
                parsed = _parse_sse_line(line)
                if parsed:
                    yield parsed


def _extract_langchain_chunk_text(chunk: Any) -> str | None:
    text = chunk.content
    if isinstance(text, str) and text:
        return text
    if isinstance(text, list):
        combined = "".join(str(c) for c in text if c)
        if combined:
            return combined
    return None


async def _stream_fallback_langchain(
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
        reasoning = chunk.additional_kwargs.get(
            "reasoning_content"
        ) or chunk.additional_kwargs.get("thought")
        if reasoning and isinstance(reasoning, str):
            yield f"<thought>{reasoning}</thought>"

        text = _extract_langchain_chunk_text(chunk)
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
        formatted_msgs = _format_messages_for_openai(messages)
        streamed = False
        async for token in _stream_direct_openai_proxy(
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

    async for token in _stream_fallback_langchain(messages, target_model):
        yield token


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


def _clean_ai_title_response(raw_text: Any) -> str | None:
    if not isinstance(raw_text, str):
        return None
    cleaned = raw_text.strip().strip("\"'`")
    cleaned = re.sub(r"^(?:Title:\s*)", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = cleaned.rstrip(".:;!?")
    return cleaned if cleaned and len(cleaned) <= 60 else None


async def generate_ai_thread_title(
    *,
    user_prompt: str,
    assistant_response: str,
    model: str | None = None,
) -> str | None:
    """Use lightweight LLM invocation to produce a crisp 3-5 word conversation title."""
    try:
        messages: list[BaseMessage] = [
            SystemMessage(
                content=(
                    "You are a thread naming assistant. Create a concise 3 to 5 word title "
                    "that summarizes the user's intent. Return ONLY the title in Title Case. "
                    "Do not include quotes, periods, prefixes like 'Title:', or extra commentary."
                )
            ),
            HumanMessage(
                content=(
                    f"User: {user_prompt[:250]}\n"
                    f"Assistant: {assistant_response[:250]}\n\n"
                    "Title:"
                )
            ),
        ]
        target_model = model or settings.AI_MODEL
        chat_model = get_chat_model(
            model=target_model,
            temperature=0.3,
            max_tokens=25,
            streaming=False,
        )
        res = await chat_model.ainvoke(messages)
        return _clean_ai_title_response(res.content)
    except Exception:
        pass
    return None
