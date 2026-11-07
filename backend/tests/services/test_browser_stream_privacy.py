from collections.abc import AsyncGenerator
from typing import Any
from unittest.mock import MagicMock

import pytest
from langchain_core.messages import AIMessageChunk

from app.services.ai_chat_runner import stream_agent_events


def _agent(*, chunks: list[str]) -> Any:
    async def events(
        _input: Any, *, version: str
    ) -> AsyncGenerator[dict[str, Any], None]:
        assert version == "v2"
        for content in chunks:
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": AIMessageChunk(content=content)},
            }

    agent = MagicMock()
    agent.astream_events = events
    return agent


async def _collect(
    *, chunks: list[str], promote_thought_fallback: bool = False
) -> list[tuple[str, dict[str, Any]]]:
    return [
        event
        async for event in stream_agent_events(
            agent=_agent(chunks=chunks),
            messages=[],
            promote_thought_fallback=promote_thought_fallback,
        )
    ]


@pytest.mark.anyio
async def test_browser_stream_drops_unclosed_thought_at_eof() -> None:
    events = await _collect(chunks=["<thought>Private internal reasoning"])

    assert not any(name == "text_delta" for name, _ in events)


@pytest.mark.anyio
async def test_browser_stream_drops_ambiguous_unclosed_thought_tail() -> None:
    events = await _collect(
        chunks=["<thought>Private reasoning\n\nPossibly private continuation"]
    )

    assert not any(name == "text_delta" for name, _ in events)


@pytest.mark.anyio
@pytest.mark.parametrize(
    "chunks",
    [
        ["<thought>Private planning\n\nHere is a private draft."],
        ["<thought>Private planning\n\n", "Here is a private draft."],
    ],
)
async def test_browser_stream_never_recovers_text_from_an_unclosed_thought(
    chunks: list[str],
) -> None:
    events = await _collect(chunks=chunks)

    assert not any(name == "text_delta" for name, _ in events)


@pytest.mark.anyio
async def test_browser_stream_keeps_outside_text_but_drops_partial_thought_tag() -> (
    None
):
    events = await _collect(chunks=["Visible answer <tho"])

    visible = "".join(
        str(data.get("content", "")) for name, data in events if name == "text_delta"
    )
    assert visible == "Visible answer "


@pytest.mark.anyio
async def test_browser_stream_keeps_completed_outside_thought_prose() -> None:
    events = await _collect(chunks=["<thought>Private</thought>Visible answer"])

    visible = "".join(
        str(data.get("content", "")) for name, data in events if name == "text_delta"
    )
    assert visible == "Visible answer"


@pytest.mark.anyio
async def test_ordinary_stream_keeps_legacy_unclosed_thought_recovery() -> None:
    events = await _collect(
        chunks=["<thought>Planning only\n\nThe answer is ready."],
        promote_thought_fallback=True,
    )

    assert any(name == "text_delta" for name, _ in events)
