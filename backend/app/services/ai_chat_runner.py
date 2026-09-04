import json
import logging
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
from app.services.ai_image_utils import normalize_image_url, sanitize_image_urls
from app.services.ai_stream_parser import (
    process_buffer_step,
    stream_parsed_chunks,
)

logger = logging.getLogger(__name__)

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


def _extract_image_url_from_part(part: dict[str, Any]) -> str:
    """Extract raw image URL or base64 from a part."""
    if part.get("type") not in ("image_url", "image"):
        return ""
    img_val = part.get("image_url")
    if isinstance(img_val, dict):
        return str(img_val.get("url", "")).strip()
    if isinstance(img_val, str):
        return img_val.strip()
    return str(part.get("url", "")).strip()


def _extract_images_from_parts(parts: list[dict[str, Any]]) -> list[str]:
    """Extract and normalize image URLs from message parts."""
    images: list[str] = []
    for part in parts:
        raw_url = _extract_image_url_from_part(part)
        if raw_url:
            normalized = normalize_image_url(url=raw_url)
            if normalized:
                images.append(normalized)
    return images


def _build_human_message_content(
    text: str, images: list[str] | None = None
) -> str | list[str | dict[Any, Any]]:
    if not images:
        return text or "[Empty message]"
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


def _get_draft_field(
    primary: dict[str, Any], fallback: dict[str, Any], *keys: str, default: str = ""
) -> str:
    for k in keys:
        val = primary.get(k) or fallback.get(k)
        if val:
            return str(val)
    return default


def _extract_draft_block_from_artifact(part: dict[str, Any]) -> str | None:
    if part.get("type") != "draft_artifact":
        return None
    art = part.get("artifact") or {}
    content = _get_draft_field(art, part, "content")
    if not content:
        return None
    post_id = _get_draft_field(art, part, "postId", "id", "post_id")
    platform = _get_draft_field(art, part, "platform", default="x")
    id_str = f" (Post ID: {post_id})" if post_id else ""
    return f"[Draft Post{id_str}, Platform: {platform}]:\n{content}"


def _extract_output_payload(output: Any) -> tuple[str | None, str, str]:
    if isinstance(output, dict) and output.get("content"):
        p_id = output.get("post_id") or output.get("id") or ""
        return output["content"], str(p_id), str(output.get("platform", "x"))
    return None, "", "x"


def _extract_input_payload(inp: Any) -> tuple[str | None, str, str]:
    if isinstance(inp, dict):
        content = inp.get("content") or inp.get("refined_content")
        if content:
            return content, str(inp.get("post_id", "")), str(inp.get("platform", "x"))
    return None, "", "x"


def _extract_tool_payload(
    tool_data: dict[str, Any], part: dict[str, Any]
) -> tuple[str | None, str, str]:
    content, p_id, plat = _extract_output_payload(
        tool_data.get("output") or part.get("output")
    )
    if content:
        return content, p_id, plat
    return _extract_input_payload(tool_data.get("input") or part.get("input"))


def _extract_draft_block_from_tool_call(part: dict[str, Any]) -> str | None:
    if part.get("type") not in ("tool-call", "tool_call"):
        return None
    name = part.get("name") or part.get("tool", {}).get("name")
    if name not in ("save_draft_post", "update_draft_post"):
        return None
    content, post_id, platform = _extract_tool_payload(part.get("tool", {}), part)
    if not content:
        return None
    id_str = f" (Post ID: {post_id})" if post_id else ""
    return f"[Draft Post{id_str}, Platform: {platform}]:\n{content}"


def _extract_assistant_content_from_parts(parts: list[dict[str, Any]]) -> str:
    """Extract full conversational content including text and draft artifacts from assistant parts."""
    blocks: list[str] = []
    for part in parts:
        draft_block = _extract_draft_block_from_artifact(
            part
        ) or _extract_draft_block_from_tool_call(part)
        if draft_block:
            blocks.append(draft_block)
        elif part.get("type") == "text" and part.get("text"):
            blocks.append(str(part["text"]))

    return "\n\n".join(b.strip() for b in blocks if b.strip()).strip()


def _convert_assistant_turn(
    thought: str, parts: list[dict[str, Any]]
) -> AIMessage | None:
    content = _extract_assistant_content_from_parts(parts)
    if not content and not thought:
        return None
    return AIMessage(
        content=_build_assistant_history_content(thought=thought, text=content)
    )


def _convert_transcript_item(item: dict[str, Any]) -> BaseMessage | None:
    role = item.get("role")
    parts = item.get("parts", [])
    if role == "user":
        text = _extract_text_from_parts(parts)
        images = _extract_images_from_parts(parts)
        return _convert_user_turn(text, images)
    if role == "assistant":
        thought = _extract_thought_from_parts(parts)
        return _convert_assistant_turn(thought, parts)
    return None


def _ensure_latest_human_message(
    converted: list[BaseMessage],
    current_message: str,
    images: list[str] | None = None,
) -> None:
    if not current_message and not images:
        return
    user_turn = _convert_user_turn(current_message, images or [])
    if not user_turn:
        return
    if converted and isinstance(converted[-1], HumanMessage):
        converted[-1] = user_turn
    else:
        converted.append(user_turn)


def _build_message_history(
    *,
    transcript: dict[str, Any] | None,
    current_message: str,
    max_history_messages: int = 10,
    images: list[str] | None = None,
) -> list[BaseMessage]:
    """Convert JSONB transcript messages into LangChain BaseMessage objects."""
    raw_messages = (transcript or {}).get("messages", [])
    converted = [
        msg
        for item in raw_messages
        if (msg := _convert_transcript_item(item)) is not None
    ]
    clean_images = sanitize_image_urls(images=images) if images else None
    _ensure_latest_human_message(converted, current_message, images=clean_images)
    if len(converted) > max_history_messages:
        converted = converted[-max_history_messages:]

    return [SystemMessage(content=LINKX_SYSTEM_PROMPT), *converted]


def _normalize_tool_output(raw_output: Any) -> Any:
    val = getattr(raw_output, "content", raw_output)
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return val
    return val


def _handle_start_event(
    event: dict[str, Any], thought_buffer: str, in_thought: bool
) -> tuple[list[tuple[str, dict[str, Any]]], str]:
    emitted: list[tuple[str, dict[str, Any]]] = []
    if thought_buffer:
        emitted.append(
            ("thought" if in_thought else "text_delta", {"content": thought_buffer})
        )
    emitted.append(
        (
            "tool_start",
            {
                "id": str(event.get("run_id", "")),
                "name": str(event.get("name", "")),
                "input": event.get("data", {}).get("input", {}),
            },
        )
    )
    return emitted, ""


def _handle_tool_end_events(
    event: dict[str, Any],
) -> list[tuple[str, dict[str, Any]]]:
    name = str(event.get("name", ""))
    output_data = _normalize_tool_output(event.get("data", {}).get("output"))
    events: list[tuple[str, dict[str, Any]]] = [
        (
            "tool_output",
            {"id": str(event.get("run_id", "")), "name": name, "output": output_data},
        )
    ]
    if name in ("save_draft_post", "update_draft_post") and isinstance(
        output_data, dict
    ):
        if output_data.get("post_id"):
            events.append(("draft_artifact", output_data))
    return events


def _process_model_chunk(
    chunk: Any, thought_buffer: str, in_thought: bool
) -> tuple[list[tuple[str, dict[str, Any]]], str, bool]:
    emitted_events: list[tuple[str, dict[str, Any]]] = []
    reasoning = (
        getattr(chunk, "additional_kwargs", {}).get("reasoning_content")
        if hasattr(chunk, "additional_kwargs")
        else None
    )
    if isinstance(reasoning, str):
        emitted_events.append(("thought", {"content": reasoning}))

    chunk_content = getattr(chunk, "content", None)
    if isinstance(chunk_content, str) and chunk_content:
        thought_buffer += chunk_content
        while thought_buffer:
            emitted, is_partial, thought_buffer, in_thought, ev_type = (
                process_buffer_step(thought_buffer, in_thought)
            )
            if emitted:
                emitted_events.append((ev_type, {"content": emitted}))
            if is_partial:
                break
    return emitted_events, thought_buffer, in_thought


def _handle_supervisor_event(
    event: dict[str, Any], thought_buffer: str, in_thought: bool
) -> tuple[list[tuple[str, dict[str, Any]]], str, bool]:
    kind = event.get("event")
    if kind == "on_tool_start":
        evs, buf = _handle_start_event(event, thought_buffer, in_thought)
        return evs, buf, in_thought
    if kind == "on_tool_end":
        return _handle_tool_end_events(event), thought_buffer, in_thought
    if kind == "on_chat_model_stream":
        return _process_model_chunk(
            event.get("data", {}).get("chunk"), thought_buffer, in_thought
        )
    return [], thought_buffer, in_thought


async def _stream_agent_supervisor_events(
    *,
    agent: Any,
    messages: list[Any],
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    """Process LangGraph agent stream events and yield chat SSE tuples."""
    in_thought = False
    thought_buffer = ""

    async for event in agent.astream_events({"messages": messages}, version="v2"):
        events, thought_buffer, in_thought = _handle_supervisor_event(
            event, thought_buffer, in_thought
        )
        for ev in events:
            yield ev

    if thought_buffer:
        yield ("thought" if in_thought else "text_delta", {"content": thought_buffer})


async def default_chat_stream_runner(
    *,
    message: str,
    transcript: dict[str, Any] | None = None,
    model: str | None = None,
    **kwargs: Any,
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    """Stream AI chat conversation tokens, tool executions, and artifacts."""
    images = kwargs.get("images")
    messages = _build_message_history(
        transcript=transcript,
        current_message=message,
        images=images,
    )
    user_id = kwargs.get("user_id")
    session = kwargs.get("session")
    thread_id = kwargs.get("thread_id")

    if user_id and session:
        try:
            from app.services.agentic.agent_supervisor import build_copilot_agent

            agent = build_copilot_agent(
                user_id=user_id,
                session=session,
                model=model,
                thread_id=thread_id,
            )
            conv_messages = [m for m in messages if not isinstance(m, SystemMessage)]
            async for ev in _stream_agent_supervisor_events(
                agent=agent, messages=conv_messages
            ):
                yield ev
            yield ("done", {})
            return
        except Exception as exc:
            logger.warning(
                "Agent supervisor error, falling back to direct stream: %s", exc
            )

    try:
        async for event in stream_parsed_chunks(
            stream_raw_chat_completion(messages=messages, model=model),
            delay=0.0,
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
