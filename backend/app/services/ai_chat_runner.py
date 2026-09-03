import json
import re
from collections.abc import AsyncGenerator
from typing import Any

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
)

from app.core.config import settings
from app.services.agentic.client import get_chat_model
from app.services.ai_completion_client import stream_raw_chat_completion
from app.services.ai_stream_parser import stream_parsed_chunks

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


def _extract_thought_from_parts(parts: list[dict[str, Any]]) -> str:
    """Extract concatenated thought content from message parts."""
    thoughts = [
        str(part.get("content", ""))
        for part in parts
        if part.get("type") == "thought" and part.get("content")
    ]
    return "\n".join(thoughts).strip()


def _build_assistant_history_content(thought: str, text: str) -> str:
    if thought and text:
        return f"<thought>{thought}</thought>\n\n{text}"
    if thought:
        return f"<thought>{thought}</thought>"
    return text


def _extract_images_from_parts(parts: list[dict[str, Any]]) -> list[str]:
    """Extract image URLs from message parts."""
    images: list[str] = []
    for part in parts:
        ptype = part.get("type")
        if ptype in ("image_url", "image"):
            url = ""
            if isinstance(part.get("image_url"), dict):
                url = str(part["image_url"].get("url", "")).strip()
            elif isinstance(part.get("image_url"), str):
                url = str(part.get("image_url", "")).strip()
            elif part.get("url"):
                url = str(part.get("url", "")).strip()
            if url:
                images.append(url)
    return images


def _build_human_message_content(
    text: str, images: list[str] | None = None
) -> str | list[str | dict[Any, Any]]:
    if not images:
        return text
    content: list[str | dict[Any, Any]] = []
    if text:
        content.append({"type": "text", "text": text})
    for img in images:
        if img:
            content.append({"type": "image_url", "image_url": {"url": img}})
    return content


def _convert_user_turn(text: str, images: list[str]) -> HumanMessage | None:
    if not text and not images:
        return None
    return HumanMessage(content=_build_human_message_content(text, images))


def _convert_assistant_turn(thought: str, text: str) -> AIMessage | None:
    if not text and not thought:
        return None
    return AIMessage(content=_build_assistant_history_content(thought, text))


def _convert_transcript_item(item: dict[str, Any]) -> BaseMessage | None:
    role = item.get("role")
    parts = item.get("parts", [])
    if role == "user":
        return _convert_user_turn(
            text=_extract_text_from_parts(parts),
            images=_extract_images_from_parts(parts),
        )
    if role == "assistant":
        return _convert_assistant_turn(
            thought=_extract_thought_from_parts(parts),
            text=_extract_text_from_parts(parts),
        )
    return None


def _is_latest_message_matching(
    converted: list[BaseMessage],
    current_message: str,
    images: list[str] | None = None,
) -> bool:
    if not converted:
        return False
    last = converted[-1]
    if not isinstance(last, HumanMessage):
        return False
    expected_content = _build_human_message_content(current_message, images)
    return last.content == expected_content


def _ensure_latest_human_message(
    converted: list[BaseMessage],
    current_message: str,
    images: list[str] | None = None,
) -> None:
    if not _is_latest_message_matching(converted, current_message, images):
        content = _build_human_message_content(current_message, images)
        converted.append(HumanMessage(content=content))


def _build_message_history(
    *,
    transcript: dict[str, Any] | None,
    current_message: str,
    max_history_messages: int = 40,
    images: list[str] | None = None,
) -> list[BaseMessage]:
    """Convert JSONB transcript messages into LangChain BaseMessage objects."""
    raw_messages = (transcript or {}).get("messages", [])
    converted = [
        msg
        for item in raw_messages
        if (msg := _convert_transcript_item(item)) is not None
    ]
    _ensure_latest_human_message(converted, current_message, images=images)
    if len(converted) > max_history_messages:
        converted = converted[-max_history_messages:]

    return [SystemMessage(content=LINKX_SYSTEM_PROMPT), *converted]


async def default_chat_stream_runner(
    *,
    message: str,
    transcript: dict[str, Any] | None = None,
    smooth_delay: float = 0.0,
    model: str | None = None,
    images: list[str] | None = None,
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    """Stream AI chat conversation tokens and thinking thoughts word-by-word."""
    messages = _build_message_history(
        transcript=transcript,
        current_message=message,
        images=images,
    )

    try:
        async for event in stream_parsed_chunks(
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
