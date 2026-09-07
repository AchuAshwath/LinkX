"""Stream delta accumulation and interrupted turn persistence for AI chat."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


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


def _complete_tool_fields(part: dict[str, Any], output: Any) -> None:
    part["state"] = "completed"
    if output is not None:
        part["output"] = output
    tool_data = part.get("tool")
    if isinstance(tool_data, dict):
        tool_data["state"] = "completed"
        tool_data["output"] = output


def _update_existing_tool_part(
    parts: list[dict[str, Any]], *, tool_id: str, tool_name: str, output: Any
) -> bool:
    for part in reversed(parts):
        if _is_matching_tool_part(part=part, tool_id=tool_id, tool_name=tool_name):
            _complete_tool_fields(part, output)
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


def append_stream_part(
    parts: list[dict[str, Any]], *, event: str, data: dict[str, Any]
) -> None:
    """Append or merge streaming SSE deltas into accumulated parts array."""
    dispatch: dict[str, Callable[[], None]] = {
        "text_delta": lambda: _append_text_delta(
            parts, text=str(data.get("content", ""))
        ),
        "thought": lambda: _append_thought_delta(
            parts, thought=str(data.get("content", ""))
        ),
        "tool_start": lambda: _append_tool_call(parts, event=event, data=data),
        "tool_output": lambda: _append_tool_call(parts, event=event, data=data),
        "draft_artifact": lambda: _append_draft_artifact(parts, data=data),
    }
    handler = dispatch.get(event)
    if handler:
        handler()


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


def persist_interrupted_turn(
    *, session: Any, thread: Any, thread_id: Any, parts: list[dict[str, Any]]
) -> None:
    """Save partial assistant turn to DB when request is cancelled or disconnected."""
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


_append_stream_part = append_stream_part
_persist_interrupted_turn = persist_interrupted_turn
