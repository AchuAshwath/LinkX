"""Filter nested duplicate tool lifecycle events from wrapped tool calls."""

from __future__ import annotations

from typing import Any


class ToolEventFilter:
    """Keep the outer lifecycle when a same-name tool wrapper nests its call."""

    def __init__(self) -> None:
        self._active: dict[str, str] = {}
        self._suppressed: set[str] = set()

    def should_emit(self, *, event: dict[str, Any]) -> bool:
        handlers = {
            "on_tool_start": self._start,
            "on_tool_end": self._finish,
            "on_tool_error": self._finish,
        }
        handler = handlers.get(str(event.get("event")))
        return handler(event=event) if handler is not None else True

    def _start(self, *, event: dict[str, Any]) -> bool:
        run_id = str(event.get("run_id", ""))
        name = str(event.get("name", ""))
        if self._is_nested_same_tool(event=event, name=name):
            self._suppressed.add(run_id)
            return False
        self._active[run_id] = name
        return True

    def _finish(self, *, event: dict[str, Any]) -> bool:
        run_id = str(event.get("run_id", ""))
        if run_id in self._suppressed:
            self._suppressed.discard(run_id)
            return False
        self._active.pop(run_id, None)
        return True

    def _is_nested_same_tool(self, *, event: dict[str, Any], name: str) -> bool:
        parent_ids = event.get("parent_ids", [])
        return any(self._active.get(str(parent_id)) == name for parent_id in parent_ids)
