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
from sqlmodel import Session

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


def _extract_images_from_parts(parts: list[dict[str, Any]]) -> list[str]:
    """Extract and normalize image URLs from message parts."""
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
                normalized = normalize_image_url(url=url)
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


def _extract_assistant_content_from_parts(parts: list[dict[str, Any]]) -> str:
    """Extract full conversational content including text and draft artifacts from assistant parts."""
    blocks: list[str] = []

    # 1. Extract any draft artifacts or draft tool calls
    for part in parts:
        ptype = part.get("type")
        if ptype == "draft_artifact":
            artifact = part.get("artifact", {})
            post_id = (
                artifact.get("postId")
                or artifact.get("id")
                or part.get("post_id")
                or ""
            )
            content = artifact.get("content") or part.get("content") or ""
            platform = artifact.get("platform") or part.get("platform") or "x"
            if content:
                id_str = f" (Post ID: {post_id})" if post_id else ""
                blocks.append(f"[Draft Post{id_str}, Platform: {platform}]:\n{content}")
        elif ptype in ("tool-call", "tool_call"):
            tool_name = part.get("name") or part.get("tool", {}).get("name")
            if tool_name in ("save_draft_post", "update_draft_post"):
                tool_data = part.get("tool", {})
                tool_output = tool_data.get("output") or part.get("output") or {}
                tool_input = tool_data.get("input") or part.get("input") or {}
                if isinstance(tool_output, dict) and tool_output.get("content"):
                    p_id = tool_output.get("post_id") or tool_output.get("id") or ""
                    p_content = tool_output.get("content")
                    p_plat = tool_output.get("platform", "x")
                    id_str = f" (Post ID: {p_id})" if p_id else ""
                    blocks.append(
                        f"[Draft Post{id_str}, Platform: {p_plat}]:\n{p_content}"
                    )
                elif isinstance(tool_input, dict) and (
                    tool_input.get("content") or tool_input.get("refined_content")
                ):
                    p_content = tool_input.get("content") or tool_input.get(
                        "refined_content"
                    )
                    p_id = tool_input.get("post_id", "")
                    p_plat = tool_input.get("platform", "x")
                    id_str = f" (Post ID: {p_id})" if p_id else ""
                    blocks.append(
                        f"[Draft Post{id_str}, Platform: {p_plat}]:\n{p_content}"
                    )

    # 2. Extract conversational text
    text_chunks = [
        str(part.get("text", ""))
        for part in parts
        if part.get("type") == "text" and part.get("text")
    ]
    if text_chunks:
        blocks.append("\n".join(text_chunks).strip())

    return "\n\n".join(b for b in blocks if b.strip()).strip()


def _convert_assistant_turn(
    thought: str, parts: list[dict[str, Any]]
) -> AIMessage | None:
    content = _extract_assistant_content_from_parts(parts)
    if not content and not thought:
        return None
    return AIMessage(content=_build_assistant_history_content(thought, content))


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
            parts=parts,
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
    clean_images = sanitize_image_urls(images=images) if images else None
    _ensure_latest_human_message(converted, current_message, images=clean_images)
    if len(converted) > max_history_messages:
        converted = converted[-max_history_messages:]

    return [SystemMessage(content=LINKX_SYSTEM_PROMPT), *converted]


def _normalize_tool_output(raw_output: Any) -> Any:
    if hasattr(raw_output, "content"):
        content = raw_output.content
        if isinstance(content, str):
            try:
                return json.loads(content)
            except Exception:
                return content
        return content
    if isinstance(raw_output, str):
        try:
            return json.loads(raw_output)
        except Exception:
            return raw_output
    return raw_output


async def default_chat_stream_runner(
    *,
    message: str,
    transcript: dict[str, Any] | None = None,
    model: str | None = None,
    images: list[str] | None = None,
    user_id: str | None = None,
    session: Session | None = None,
    thread_id: str | None = None,
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    """Stream AI chat conversation tokens, tool executions, and artifacts."""
    messages = _build_message_history(
        transcript=transcript,
        current_message=message,
        images=images,
    )

    if user_id and session:
        try:
            from app.services.agentic.agent_supervisor import build_copilot_agent

            agent = build_copilot_agent(
                user_id=user_id,
                session=session,
                model=model,
                thread_id=thread_id,
            )
            # Strip generic SystemMessage so create_react_agent uses its own copilot prompt with thread context
            conversation_messages = [
                m for m in messages if not isinstance(m, SystemMessage)
            ]
            in_thought = False
            thought_buffer = ""

            async for event in agent.astream_events(
                {"messages": conversation_messages}, version="v2"
            ):
                kind = event.get("event")
                if kind == "on_tool_start":
                    if thought_buffer:
                        final_ev = "thought" if in_thought else "text_delta"
                        yield (final_ev, {"content": thought_buffer})
                        thought_buffer = ""

                    run_id = str(event.get("run_id", ""))
                    name = str(event.get("name", ""))
                    input_data = event.get("data", {}).get("input", {})
                    yield (
                        "tool_start",
                        {"id": run_id, "name": name, "input": input_data},
                    )
                elif kind == "on_tool_end":
                    run_id = str(event.get("run_id", ""))
                    name = str(event.get("name", ""))
                    raw_output = event.get("data", {}).get("output")
                    output_data = _normalize_tool_output(raw_output)
                    yield (
                        "tool_output",
                        {"id": run_id, "name": name, "output": output_data},
                    )

                    # Detect and emit rich artifact events for the UI
                    if name in (
                        "save_draft_post",
                        "update_draft_post",
                    ) and isinstance(output_data, dict):
                        if output_data.get("post_id"):
                            yield ("draft_artifact", output_data)

                elif kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    # Handle reasoning content if provided by provider in kwargs
                    reasoning = (
                        getattr(chunk, "additional_kwargs", {}).get("reasoning_content")
                        if hasattr(chunk, "additional_kwargs")
                        else None
                    )
                    if reasoning and isinstance(reasoning, str):
                        yield ("thought", {"content": reasoning})

                    if (
                        hasattr(chunk, "content")
                        and isinstance(chunk.content, str)
                        and chunk.content
                    ):
                        thought_buffer += chunk.content
                        while thought_buffer:
                            emitted, is_partial, thought_buffer, in_thought, ev_type = (
                                process_buffer_step(thought_buffer, in_thought)
                            )
                            if emitted:
                                yield (ev_type, {"content": emitted})
                            if is_partial:
                                break

            if thought_buffer:
                final_ev = "thought" if in_thought else "text_delta"
                yield (final_ev, {"content": thought_buffer})
                thought_buffer = ""

            yield ("done", {})
            return
        except Exception as exc:
            logger.warning(
                f"Agent supervisor encountered error, falling back to direct LLM stream: {exc}"
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
