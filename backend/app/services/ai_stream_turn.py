"""Accumulate transcript-safe parts from a streamed assistant turn."""

from __future__ import annotations

import copy
import re
from collections.abc import Iterator
from typing import Any

from app.services.ai_turn_accumulator import append_stream_part

_BROWSER_TOOL_NAMES = {"read_browser_context"}
_SUPPORTED_EVENTS = {
    "text_delta",
    "tool_start",
    "tool_output",
    "draft_artifact",
    "trending_artifact",
}
_TRANSIENT_BROWSER_KEYS = {
    "browsercontext",
    "browsermemory",
    "browsernote",
    "browsernotes",
    "browserframe",
    "browserframes",
    "browsersnapshot",
    "imagedataurl",
    "pendingframes",
    "currentview",
    "browsersessionid",
}
_INLINE_IMAGE_DATA = re.compile(
    r"data:image/[A-Za-z0-9.+-]+(?:;[A-Za-z0-9=.+-]*)?,[^\s\"'<>}\]]+"
)


def sanitize_stream_value(value: Any) -> Any:
    """Remove transient browser payloads from persisted or replayed values."""
    if isinstance(value, dict):
        return {
            key: sanitize_stream_value(item)
            for key, item in value.items()
            if _normalize_payload_key(key) not in _TRANSIENT_BROWSER_KEYS
        }
    if isinstance(value, list):
        return [sanitize_stream_value(item) for item in value]
    if isinstance(value, str):
        return _INLINE_IMAGE_DATA.sub("[redacted image data]", value)
    return copy.deepcopy(value)


def _normalize_payload_key(key: Any) -> str:
    return str(key).casefold().replace("_", "").replace("-", "")


def sanitize_stream_parts(*, parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sanitized = sanitize_stream_value(parts)
    if not isinstance(sanitized, list):
        return []
    return [part for part in sanitized if not _is_browser_tool_part(part=part)]


def _is_browser_tool_part(*, part: Any) -> bool:
    if not isinstance(part, dict) or part.get("type") not in {"tool-call", "tool_call"}:
        return False
    tool = part.get("tool")
    name = part.get("name")
    if not isinstance(name, str) and isinstance(tool, dict):
        name = tool.get("name")
    return isinstance(name, str) and (
        name in _BROWSER_TOOL_NAMES or name.startswith("browser_")
    )


class StreamTurn:
    """Collect ordinary visible stream parts while excluding temporary browser data."""

    def __init__(self, *, allow_thought_summary: bool = False) -> None:
        self._parts: list[dict[str, Any]] = []
        self._allow_thought_summary = allow_thought_summary

    def record(self, event: str, data: dict[str, Any]) -> None:
        if event.startswith("browser_"):
            return
        data = sanitize_stream_value(data)
        if event == "thought" and self._allow_thought_summary:
            append_stream_part(self._parts, event=event, data=data)
            return
        if event not in _SUPPORTED_EVENTS or self._is_browser_tool(data=data):
            return
        if event == "trending_artifact":
            self._parts.append(
                {
                    "type": "trending_artifact",
                    "artifact": {
                        "topics": copy.deepcopy(data.get("topics", [])),
                        "count": data.get("count", len(data.get("topics", []))),
                    },
                }
            )
            return
        append_stream_part(self._parts, event=event, data=data)

    @staticmethod
    def _is_browser_tool(*, data: dict[str, Any]) -> bool:
        name = data.get("name")
        return isinstance(name, str) and (
            name in _BROWSER_TOOL_NAMES or name.startswith("browser_")
        )

    @property
    def text(self) -> str:
        return "".join(
            part.get("text", "")
            for part in self._parts
            if part.get("type") == "text" and isinstance(part.get("text"), str)
        )

    @property
    def has_visible_output(self) -> bool:
        return any(
            part.get("type")
            in {
                "text",
                "thought",
                "tool-call",
                "draft_artifact",
                "trending_artifact",
            }
            and (part.get("type") != "text" or bool(part.get("text")))
            for part in self._parts
        )

    def parts_snapshot(self) -> list[dict[str, Any]]:
        return copy.deepcopy(self._parts)

    def terminal_parts(self, *, interrupted: bool) -> list[dict[str, Any]]:
        parts = self.parts_snapshot()
        if not interrupted:
            return parts
        for part in parts:
            _interrupt_running_tool(part=part)
        return parts


def _interrupt_running_tool(*, part: dict[str, Any]) -> None:
    if part.get("state") != "running":
        return
    part["state"] = "cancelled"
    tool = part.get("tool")
    if isinstance(tool, dict):
        tool["state"] = "cancelled"


def replay_stream_parts(
    *, parts: list[dict[str, Any]]
) -> Iterator[tuple[str, dict[str, Any]]]:
    """Translate saved ordinary parts back to events without executing tools."""
    for part in sanitize_stream_parts(parts=parts):
        kind = part.get("type")
        if kind == "text" and part.get("text"):
            yield "text_delta", {"content": part["text"]}
        elif kind in {"tool-call", "tool_call"}:
            yield from _replay_tool(part=part)
        elif kind == "trending_artifact":
            yield "trending_artifact", part.get("artifact", {})
        elif kind == "draft_artifact":
            yield (
                "draft_artifact",
                {
                    **part.get("artifact", {}),
                    "post_id": part.get("post_id"),
                    "content": part.get("content", ""),
                    "platform": part.get("platform", "x"),
                },
            )


def _replay_tool(*, part: dict[str, Any]) -> Iterator[tuple[str, dict[str, Any]]]:
    name = str(part.get("name", ""))
    if name.startswith("browser_") or name in _BROWSER_TOOL_NAMES:
        return
    tool = part.get("tool", {})
    identity = {"id": part.get("toolCallId", tool.get("id", "")), "name": name}
    yield "tool_start", {**identity, "input": tool.get("input", {})}
    if part.get("state") in {"completed", "failed"}:
        yield (
            "tool_output",
            {**identity, "output": part.get("output", tool.get("output"))},
        )
