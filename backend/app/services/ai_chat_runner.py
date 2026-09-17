"""Stream AI chat conversation tokens, tool executions, and artifacts with cancellation persistence."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import AsyncGenerator
from typing import Any

from langchain_core.messages import (
    BaseMessage,
    HumanMessage,
    SystemMessage,
)

from app.core.config import settings
from app.services.agentic.client import get_chat_model
from app.services.ai_completion_client import stream_raw_chat_completion
from app.services.ai_prompt_builder import (
    LINKX_SYSTEM_PROMPT,
    _build_message_history,
    _extract_images_from_parts,
    _extract_text_from_parts,
    build_message_history,
)
from app.services.ai_stream_parser import (
    process_buffer_step,
    stream_parsed_chunks,
)
from app.services.ai_turn_accumulator import (
    _append_stream_part,
    _append_tool_call,
    _persist_interrupted_turn,
    persist_interrupted_turn,
)

__all__ = [
    "LINKX_SYSTEM_PROMPT",
    "_append_tool_call",
    "_build_message_history",
    "_extract_images_from_parts",
    "_extract_text_from_parts",
    "_handle_supervisor_event",
    "_persist_interrupted_turn",
    "build_message_history",
    "default_chat_stream_runner",
    "format_sse",
    "generate_ai_thread_title",
    "persist_interrupted_turn",
]

logger = logging.getLogger(__name__)


def format_sse(*, event: str, data: dict[str, Any]) -> str:
    """Format an SSE event string according to the SSE standard."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


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


REASONING_KEYS = ("reasoning_content", "reasoning", "thought")


def _find_reasoning_in_dict(source: Any) -> str | None:
    if not isinstance(source, dict):
        return None
    for key in REASONING_KEYS:
        val = source.get(key)
        if isinstance(val, str) and val:
            return val
    return None


def _extract_chunk_reasoning(chunk: Any) -> str | None:
    return _find_reasoning_in_dict(
        getattr(chunk, "additional_kwargs", None)
    ) or _find_reasoning_in_dict(getattr(chunk, "response_metadata", None))


def _process_model_chunk(
    chunk: Any, thought_buffer: str, in_thought: bool
) -> tuple[list[tuple[str, dict[str, Any]]], str, bool]:
    emitted_events: list[tuple[str, dict[str, Any]]] = []
    reasoning = _extract_chunk_reasoning(chunk)
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


def _handle_custom_node_event(
    event: dict[str, Any],
) -> list[tuple[str, dict[str, Any]]]:
    """Translate nested LangGraph node events into streaming UI tool cards."""
    name = str(event.get("name", ""))
    data = event.get("data", {})
    if not isinstance(data, dict):
        return []

    node_name = str(data.get("name", ""))
    if not node_name:
        return []

    node_id = f"node_{node_name}"
    if name == "scraping_node_start":
        return [
            (
                "tool_start",
                {
                    "id": node_id,
                    "name": node_name,
                    "input": data.get("input", {}),
                },
            )
        ]
    if name == "scraping_node_end":
        return [
            (
                "tool_output",
                {
                    "id": node_id,
                    "name": node_name,
                    "output": data.get("output", {}),
                },
            )
        ]
    return []


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
    if kind == "on_custom_event":
        return _handle_custom_node_event(event), thought_buffer, in_thought
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
