from collections.abc import AsyncGenerator
from typing import Any

import pytest
from langchain_core.messages import AIMessageChunk

from app.services.ai_chat_runner import _stream_agent_supervisor_events


@pytest.mark.anyio
async def test_stream_agent_supervisor_unclosed_thought_recovers_text_delta() -> None:
    """Issue #129: When agent supervisor model chunk leaves in_thought=True at stream end,
    it must recover text_delta rather than swallowing everything into thought."""

    class FakeAgent:
        async def astream_events(
            self, *args: Any, **kwargs: Any
        ) -> AsyncGenerator[dict[str, Any], None]:
            yield {
                "event": "on_chat_model_stream",
                "data": {
                    "chunk": AIMessageChunk(
                        content="<thought>Strategy notes\n\nFinal post copy"
                    )
                },
            }

    events = []
    async for ev, data in _stream_agent_supervisor_events(
        agent=FakeAgent(), messages=[]
    ):
        events.append((ev, data))

    text_deltas = [d["content"] for ev, d in events if ev == "text_delta"]
    assert len(text_deltas) > 0
    assert "Final post copy" in "".join(text_deltas)


@pytest.mark.anyio
async def test_stream_agent_supervisor_unclosed_thought_with_tool_call() -> None:
    """Adversarial Test: Agent supervisor with unclosed thought followed by tool execution and conclusion."""

    class FakeToolAgent:
        async def astream_events(
            self, *args: Any, **kwargs: Any
        ) -> AsyncGenerator[dict[str, Any], None]:
            yield {
                "event": "on_chat_model_stream",
                "data": {
                    "chunk": AIMessageChunk(
                        content="<thought>I am planning to fetch trends"
                    )
                },
            }
            yield {
                "event": "on_tool_start",
                "run_id": "tool-123",
                "name": "scrape_trends",
                "data": {"input": {"topic": "tech"}},
            }
            yield {
                "event": "on_tool_end",
                "run_id": "tool-123",
                "name": "scrape_trends",
                "data": {"output": {"trending": ["AI", "Agents"]}},
            }
            yield {
                "event": "on_chat_model_stream",
                "data": {
                    "chunk": AIMessageChunk(
                        content="Here is the trending summary based on recent data."
                    )
                },
            }

    events = []
    async for ev, data in _stream_agent_supervisor_events(
        agent=FakeToolAgent(), messages=[]
    ):
        events.append((ev, data))

    event_types = [ev for ev, _ in events]
    assert "tool_start" in event_types
    assert "tool_output" in event_types
    assert "text_delta" in event_types
    text_deltas = [d["content"] for ev, d in events if ev == "text_delta"]
    assert "Here is the trending summary" in "".join(text_deltas)
