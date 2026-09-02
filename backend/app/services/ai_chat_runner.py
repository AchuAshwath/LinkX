import json
from collections.abc import AsyncGenerator
from typing import Any


def format_sse(*, event: str, data: dict[str, Any]) -> str:
    """Format an SSE event string according to the SSE standard."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def default_chat_stream_runner(
    *,
    message: str,
    thread_id: str,  # noqa: ARG001
    context: dict[str, Any] | None = None,  # noqa: ARG001
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    """Default AI chat stream runner yielding event tuples (event_type, payload)."""
    yield ("thought", {"content": "Analyzing prompt..."})
    yield ("text_delta", {"content": f"Echo: {message}"})
    yield ("done", {})
