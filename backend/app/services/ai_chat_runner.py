import asyncio
import json
import logging
import re
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
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
from app.services.ai_context_budgeter import (
    DEFAULT_TOKEN_BUDGET,
    apply_sliding_window_budget,
    estimate_total_tokens,
    prune_tool_call_outputs,
)
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


def _extract_text_from_parts(parts: list[dict[str, Any]] | None) -> str:
    """Extract concatenated text content from message parts."""
    if not isinstance(parts, list):
        return ""
    text_chunks = [
        str(part.get("text", ""))
        for part in parts
        if isinstance(part, dict) and part.get("type") == "text" and part.get("text")
    ]
    return "\n".join(text_chunks).strip()


def _extract_thought_from_parts(parts: list[dict[str, Any]] | None) -> str:
    """Extract concatenated thought content from message parts."""
    if not isinstance(parts, list):
        return ""
    thoughts = [
        str(part.get("content", ""))
        for part in parts
        if isinstance(part, dict)
        and part.get("type") == "thought"
        and part.get("content")
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
    if not isinstance(part, dict) or part.get("type") not in ("image_url", "image"):
        return ""
    img_val = part.get("image_url")
    if isinstance(img_val, dict):
        return str(img_val.get("url", "")).strip()
    if isinstance(img_val, str):
        return img_val.strip()
    return str(part.get("url", "")).strip()


def _extract_single_image(part: dict[str, Any]) -> str | None:
    raw_url = _extract_image_url_from_part(part)
    return normalize_image_url(url=raw_url) if raw_url else None


def _extract_images_from_parts(parts: list[dict[str, Any]] | None) -> list[str]:
    """Extract and normalize image URLs from message parts."""
    if not isinstance(parts, list):
        return []
    return [
        img for p in parts if isinstance(p, dict) and (img := _extract_single_image(p))
    ]


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


def _format_draft_block(*, content: str, post_id: str, platform: str) -> str:
    id_str = f" (Post ID: {post_id})" if post_id else ""
    return f"[Draft Post{id_str}, Platform: {platform or 'x'}]:\n{content}"


def _extract_draft_block_from_artifact(part: dict[str, Any]) -> str | None:
    if not isinstance(part, dict) or part.get("type") != "draft_artifact":
        return None
    raw_art = part.get("artifact")
    art: dict[str, Any] = raw_art if isinstance(raw_art, dict) else {}
    content = _get_draft_field(art, part, "content")
    if not content:
        return None
    post_id = _get_draft_field(art, part, "postId", "id", "post_id")
    platform = _get_draft_field(art, part, "platform", default="x")
    return _format_draft_block(content=content, post_id=post_id, platform=platform)


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
    if not isinstance(part, dict) or part.get("type") not in ("tool-call", "tool_call"):
        return None
    tool_val = part.get("tool")
    tool_dict = tool_val if isinstance(tool_val, dict) else {}
    name = part.get("name") or tool_dict.get("name")
    if name not in ("save_draft_post", "update_draft_post"):
        return None
    content, post_id, platform = _extract_tool_payload(tool_dict, part)
    if not content:
        return None
    return _format_draft_block(content=content, post_id=post_id, platform=platform)


def _extract_single_assistant_block(part: dict[str, Any]) -> str | None:
    draft = _extract_draft_block_from_artifact(part)
    if draft:
        return draft
    tool_draft = _extract_draft_block_from_tool_call(part)
    if tool_draft:
        return tool_draft
    if part.get("type") == "text" and part.get("text"):
        return str(part["text"])
    return None


def _extract_assistant_content_from_parts(parts: list[dict[str, Any]]) -> str:
    """Extract full conversational content including text and draft artifacts from assistant parts."""
    if not isinstance(parts, list):
        return ""
    blocks = [
        blk
        for p in parts
        if isinstance(p, dict) and (blk := _extract_single_assistant_block(p))
    ]
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
    if not isinstance(item, dict):
        return None
    role = item.get("role")
    parts = item.get("parts", [])
    if not isinstance(parts, list):
        parts = []
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
    user_turn = _convert_user_turn(current_message, images or [])
    if not user_turn:
        return
    if converted and isinstance(converted[-1], HumanMessage):
        converted[-1] = user_turn
    else:
        converted.append(user_turn)


def _convert_transcript_messages(
    transcript: dict[str, Any] | None,
) -> list[BaseMessage]:
    raw = transcript.get("messages", []) if isinstance(transcript, dict) else []
    if not isinstance(raw, list):
        return []
    return [msg for item in raw if (msg := _convert_transcript_item(item)) is not None]


def _assemble_prompt_messages(
    transcript: dict[str, Any] | None,
    current_message: str,
    images: list[str] | None,
    max_history: int,
) -> list[BaseMessage]:
    converted = _convert_transcript_messages(transcript)
    _ensure_latest_human_message(converted, current_message, images=images)
    trimmed = converted[-max_history:] if len(converted) > max_history else converted
    return [SystemMessage(content=LINKX_SYSTEM_PROMPT), *trimmed]


def _build_message_history(
    *,
    transcript: dict[str, Any] | None,
    current_message: str,
    images: list[str] | None = None,
    **kwargs: Any,
) -> list[BaseMessage]:
    """Convert JSONB transcript into LangChain messages with token-aware context budgeting."""
    max_hist = int(kwargs.get("max_history_messages", 10))
    budget = int(kwargs.get("token_budget", DEFAULT_TOKEN_BUDGET))
    model = kwargs.get("model")
    clean_images = sanitize_image_urls(images=images) if images else None

    base_msgs = _assemble_prompt_messages(
        transcript, current_message, clean_images, max_hist
    )
    if estimate_total_tokens(base_msgs, model=model) <= budget:
        return base_msgs

    pruned = prune_tool_call_outputs(transcript, max_chars=300)
    pruned_msgs = _assemble_prompt_messages(
        pruned, current_message, clean_images, max_hist
    )
    if estimate_total_tokens(pruned_msgs, model=model) <= budget:
        return pruned_msgs

    return apply_sliding_window_budget(pruned_msgs, token_budget=budget, model=model)


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
    """Stream AI chat conversation tokens, tool executions, and artifacts with cancellation persistence."""
    messages = _build_message_history(
        transcript=transcript,
        current_message=message,
        model=model,
        **kwargs,
    )
    user_id = kwargs.get("user_id")
    session = kwargs.get("session")
    thread_id = kwargs.get("thread_id")
    thread = kwargs.get("thread")
    parts: list[dict[str, Any]] = []

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
                _append_stream_part(parts, event=ev[0], data=ev[1])
                yield ev
            yield ("done", {})
            return
        except (asyncio.CancelledError, GeneratorExit):
            _persist_interrupted_turn(
                session=session, thread=thread, thread_id=thread_id, parts=parts
            )
            raise
        except Exception as exc:
            parts.clear()
            logger.warning(
                "Agent supervisor error, falling back to direct stream: %s", exc
            )

    try:
        async for event in stream_parsed_chunks(
            stream_raw_chat_completion(messages=messages, model=model),
            delay=0.0,
        ):
            _append_stream_part(parts, event=event[0], data=event[1])
            yield event
    except (asyncio.CancelledError, GeneratorExit):
        _persist_interrupted_turn(
            session=session, thread=thread, thread_id=thread_id, parts=parts
        )
        raise
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


def _append_text_delta(parts: list[dict[str, Any]], *, text: str) -> None:
    if not text:
        return
    if parts and parts[-1].get("type") == "text":
        parts[-1]["text"] = str(parts[-1].get("text", "")) + text
        return
    parts.append({"type": "text", "text": text})


def _append_thought_delta(parts: list[dict[str, Any]], *, thought: str) -> None:
    if not thought:
        return
    if parts and parts[-1].get("type") == "thought":
        parts[-1]["content"] = str(parts[-1].get("content", "")) + thought
        return
    parts.append({"type": "thought", "content": thought})


def _is_matching_tool_part(
    *, part: dict[str, Any], tool_id: str, tool_name: str
) -> bool:
    if not isinstance(part, dict) or part.get("type") not in ("tool_call", "tool-call"):
        return False
    if part.get("toolCallId") == tool_id or part.get("name") == tool_name:
        return True
    tool_data = part.get("tool")
    return isinstance(tool_data, dict) and tool_data.get("name") == tool_name


def _update_existing_tool_part(
    parts: list[dict[str, Any]], *, tool_id: str, tool_name: str, output: Any
) -> bool:
    for part in reversed(parts):
        if _is_matching_tool_part(part=part, tool_id=tool_id, tool_name=tool_name):
            part["state"] = "completed"
            if output is not None:
                part["output"] = output
            tool_data = part.get("tool")
            if isinstance(tool_data, dict):
                tool_data["state"] = "completed"
                tool_data["output"] = output
            return True
    return False


def _append_tool_call(
    parts: list[dict[str, Any]], *, event: str, data: dict[str, Any]
) -> None:
    t_id = str(data.get("id") or "call")
    t_name = str(data.get("name") or "tool")
    if event == "tool_output" and _update_existing_tool_part(
        parts, tool_id=t_id, tool_name=t_name, output=data.get("output")
    ):
        return
    st = "running" if event == "tool_start" else "completed"
    parts.append(
        {
            "type": "tool-call",
            "toolCallId": t_id,
            "name": t_name,
            "state": st,
            "tool": {
                "id": t_id,
                "name": t_name,
                "state": st,
                "input": data.get("input", {}),
                "output": data.get("output"),
            },
        }
    )


def _append_draft_artifact(
    parts: list[dict[str, Any]], *, data: dict[str, Any]
) -> None:
    parts.append(
        {
            "type": "draft_artifact",
            "artifact": data,
            "post_id": str(data.get("post_id", "")),
            "content": str(data.get("content", "")),
            "platform": str(data.get("platform", "x")),
        }
    )


def _append_stream_part(
    parts: list[dict[str, Any]], *, event: str, data: dict[str, Any]
) -> None:
    if event == "text_delta":
        _append_text_delta(parts, text=str(data.get("content", "")))
    elif event == "thought":
        _append_thought_delta(parts, thought=str(data.get("content", "")))
    elif event in ("tool_start", "tool_output"):
        _append_tool_call(parts, event=event, data=data)
    elif event == "draft_artifact":
        _append_draft_artifact(parts, data=data)


def _resolve_target_thread(*, session: Any, thread_id: Any) -> Any:
    if not thread_id or not session:
        return None
    try:
        from app import crud

        thread_uuid = (
            uuid.UUID(str(thread_id))
            if isinstance(thread_id, (str, uuid.UUID))
            else thread_id
        )
        return crud.get_chat_thread(session=session, thread_id=thread_uuid)
    except Exception:
        return None


def _cancel_single_tool_part(part: dict[str, Any]) -> None:
    if part.get("type") in ("tool-call", "tool_call"):
        part["state"] = "cancelled"
        tool_data = part.get("tool")
        if isinstance(tool_data, dict):
            tool_data["state"] = "cancelled"


def _mark_running_tools_interrupted(parts: list[dict[str, Any]]) -> None:
    for part in parts:
        if isinstance(part, dict) and part.get("state") == "running":
            _cancel_single_tool_part(part)


def _persist_interrupted_turn(
    *, session: Any, thread: Any, thread_id: Any, parts: list[dict[str, Any]]
) -> None:
    if not session:
        return
    _mark_running_tools_interrupted(parts)
    if not parts:
        parts.append({"type": "text", "text": "*(Generation stopped)*"})
    msg = {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "role": "assistant",
        "parts": parts,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "interrupted": True,
    }
    target = thread or _resolve_target_thread(session=session, thread_id=thread_id)
    if not target:
        return
    try:
        from app import crud

        crud.append_message_to_transcript(
            session=session, db_thread=target, message=msg
        )
    except Exception as exc:
        logger.warning("Failed to persist interrupted turn: %s", exc)
