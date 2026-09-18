"""Stream delta accumulation and interrupted turn persistence for AI chat."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any, NamedTuple

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


def _is_matching_draft(part: dict[str, Any], post_id: str) -> bool:
    if part.get("type") != "draft_artifact":
        return False
    raw_art = part.get("artifact")
    art: dict[str, Any] = raw_art if isinstance(raw_art, dict) else {}
    existing_id = part.get("post_id") or art.get("id") or art.get("postId")
    if post_id and existing_id:
        return str(existing_id) == post_id
    return True


def append_or_update_draft_part(
    parts: list[dict[str, Any]], *, payload: dict[str, Any]
) -> None:
    content = str(payload.get("content", ""))
    post_id = str(payload.get("post_id", ""))
    platform = str(payload.get("platform", "x"))
    status = str(payload.get("status", "draft"))

    entry = {
        "type": "draft_artifact",
        "artifact": {
            "id": post_id,
            "postId": post_id,
            "content": content,
            "platform": platform,
            "characterCount": payload.get("char_count") or len(content),
            "status": status,
        },
        "post_id": post_id,
        "content": content,
        "platform": platform,
    }

    for idx, part in enumerate(parts):
        if _is_matching_draft(part, post_id):
            parts[idx] = entry
            return
    parts.append(entry)


def _append_draft_artifact(
    parts: list[dict[str, Any]], *, data: dict[str, Any]
) -> None:
    append_or_update_draft_part(parts, payload=data)


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
    target = thread or _resolve_target_thread(session=session, thread_id=thread_id)
    parent_id = getattr(target, "active_leaf_id", None) if target else None
    msg = {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "role": "assistant",
        "parent_id": parent_id,
        "parts": parts,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "interrupted": True,
    }
    if not target:
        return
    try:
        from app import crud

        crud.append_message_to_transcript(
            session=session, db_thread=target, message=msg
        )
    except Exception as exc:
        logger.warning("Failed to persist interrupted turn: %s", exc)


class TranscriptEditPayload(NamedTuple):
    edit_message_id: str
    message_text: str
    clean_images: list[str]


def _build_edited_user_parts(
    *, message_text: str, clean_images: list[str]
) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    if message_text:
        parts.append({"type": "text", "text": message_text})
    for img in clean_images:
        parts.append({"type": "image_url", "image_url": {"url": img}})
    return parts


def ensure_parent_ids(*, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ensure all messages have a parent_id, inferring from array order for legacy data."""
    if not messages:
        return []
    result: list[dict[str, Any]] = []
    prev_id: str | None = None
    for i, msg in enumerate(messages):
        item = dict(msg)
        raw_pid = item.get("parent_id")
        forked_from = item.get("forked_from_id")
        if i == 0:
            item["parent_id"] = None
        elif raw_pid is not None:
            item["parent_id"] = str(raw_pid)
        elif raw_pid is None and forked_from is not None:
            item["parent_id"] = None
        else:
            item["parent_id"] = prev_id
        result.append(item)
        prev_id = item.get("id")
    return result


def _select_target_leaf_id(
    *,
    active_leaf_id: str | None,
    id_map: dict[str, dict[str, Any]],
    fallback_id: str | None,
) -> str | None:
    if active_leaf_id in id_map:
        return active_leaf_id
    if fallback_id in id_map:
        return fallback_id
    return None


def _walk_branch_to_root(
    *, target_id: str, id_map: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    visited: set[str] = set()
    path: list[dict[str, Any]] = []
    curr_id: str | None = target_id
    while curr_id:
        if curr_id in visited:
            break
        node = id_map.get(curr_id)
        if not node:
            break
        visited.add(curr_id)
        path.append(node)
        curr_id = node.get("parent_id")
    path.reverse()
    return path


def resolve_active_branch(
    *,
    messages: list[dict[str, Any]],
    active_leaf_id: str | None = None,
) -> list[dict[str, Any]]:
    """Walk backward from active_leaf_id via parent_id to build chronological active path."""
    if not messages:
        return []
    normalized = ensure_parent_ids(messages=messages)
    id_map = {m["id"]: m for m in normalized if m.get("id")}
    fallback_id = normalized[-1].get("id")
    target_id = _select_target_leaf_id(
        active_leaf_id=active_leaf_id,
        id_map=id_map,
        fallback_id=fallback_id,
    )
    if not target_id:
        return normalized
    return _walk_branch_to_root(target_id=target_id, id_map=id_map)


def find_sibling_branches(
    *,
    messages: list[dict[str, Any]],
    message_id: str,
) -> list[dict[str, Any]]:
    """Return all messages that share the same parent_id as the given message."""
    normalized = ensure_parent_ids(messages=messages)
    target = next((m for m in normalized if m.get("id") == message_id), None)
    if not target:
        return []
    parent_id = target.get("parent_id")
    return [m for m in normalized if m.get("parent_id") == parent_id]


def _build_children_map(
    *,
    messages: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    children_map: dict[str, list[dict[str, Any]]] = {}
    for m in messages:
        p_id = m.get("parent_id")
        if p_id:
            children_map.setdefault(p_id, []).append(m)
    return children_map


def _next_unvisited_child_id(
    *,
    children_map: dict[str, list[dict[str, Any]]],
    curr: str,
    visited: set[str],
) -> str | None:
    children = children_map.get(curr)
    if not children:
        return None
    next_id = children[-1].get("id")
    if not next_id:
        return None
    if next_id in visited:
        return None
    return str(next_id)


def find_deepest_leaf(
    *,
    messages: list[dict[str, Any]],
    node_id: str,
) -> str:
    """Find the deepest leaf descendant starting from node_id, following the latest child."""
    normalized = ensure_parent_ids(messages=messages)
    children_map = _build_children_map(messages=normalized)

    curr = node_id
    visited: set[str] = {curr}
    while True:
        next_id = _next_unvisited_child_id(
            children_map=children_map, curr=curr, visited=visited
        )
        if not next_id:
            break
        visited.add(next_id)
        curr = next_id
    return curr


def _create_branch_user_message(
    *,
    target: dict[str, Any],
    payload: TranscriptEditPayload,
) -> dict[str, Any]:
    return {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "role": "user",
        "parent_id": target.get("parent_id"),
        "parts": _build_edited_user_parts(
            message_text=payload.message_text,
            clean_images=payload.clean_images,
        ),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "forked_from_id": target.get("id"),
    }


def _handle_assistant_regeneration(
    *,
    target: dict[str, Any],
    thread: Any,
    session: Any,
) -> bool:
    parent_id = target.get("parent_id")
    thread.active_leaf_id = parent_id
    transcript = dict(thread.transcript or {})
    transcript["active_leaf_id"] = parent_id
    thread.transcript = transcript
    thread.updated_at = datetime.now(timezone.utc)
    session.add(thread)
    session.commit()
    session.refresh(thread)
    return True


def apply_transcript_branch(
    *,
    session: Any,
    thread: Any,
    payload: TranscriptEditPayload,
) -> bool:
    """Create a non-destructive sibling branch in the transcript DAG."""
    if not session or not thread:
        return False
    transcript = dict(thread.transcript or {})
    messages = ensure_parent_ids(messages=list(transcript.get("messages", [])))
    target = next(
        (m for m in messages if m.get("id") == payload.edit_message_id),
        None,
    )
    if not target:
        return False

    if target.get("role") != "user":
        return _handle_assistant_regeneration(
            target=target, thread=thread, session=session
        )

    new_user_msg = _create_branch_user_message(target=target, payload=payload)
    messages.append(new_user_msg)
    transcript["messages"] = messages
    transcript["active_leaf_id"] = new_user_msg["id"]
    thread.transcript = transcript
    thread.active_leaf_id = new_user_msg["id"]
    thread.message_count = len(messages)
    thread.updated_at = datetime.now(timezone.utc)
    session.add(thread)
    session.commit()
    session.refresh(thread)
    return True


apply_transcript_edit = apply_transcript_branch
_append_stream_part = append_stream_part
_persist_interrupted_turn = persist_interrupted_turn
