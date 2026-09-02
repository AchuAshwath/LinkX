from collections.abc import AsyncGenerator
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    HumanMessage,
    SystemMessage,
)

from app.services.ai_chat_runner import (
    LINKX_SYSTEM_PROMPT,
    _build_message_history,
    _extract_text_from_parts,
    _stream_parsed_chunks,
    _stream_text_smoothly,
    default_chat_stream_runner,
    format_sse,
)


def test_format_sse() -> None:
    result = format_sse(event="thought", data={"content": "Processing"})
    assert result == 'event: thought\ndata: {"content": "Processing"}\n\n'


def test_extract_text_from_parts() -> None:
    parts = [
        {"type": "thought", "content": "Internal thought"},
        {"type": "text", "text": "First line"},
        {"type": "tool_call", "name": "some_tool"},
        {"type": "text", "text": "Second line"},
    ]
    extracted = _extract_text_from_parts(parts)
    assert extracted == "First line\nSecond line"


def test_build_message_history_empty_transcript() -> None:
    messages = _build_message_history(
        transcript=None,
        current_message="Hello LinkX",
    )
    assert len(messages) == 2
    assert isinstance(messages[0], SystemMessage)
    assert messages[0].content == LINKX_SYSTEM_PROMPT
    assert isinstance(messages[1], HumanMessage)
    assert messages[1].content == "Hello LinkX"


def test_build_message_history_multi_turn() -> None:
    transcript = {
        "messages": [
            {
                "role": "user",
                "parts": [{"type": "text", "text": "Draft a post"}],
            },
            {
                "role": "assistant",
                "parts": [
                    {"type": "thought", "content": "Analyzing..."},
                    {"type": "text", "text": "Here is the post."},
                ],
            },
            {
                "role": "user",
                "parts": [{"type": "text", "text": "Make it shorter"}],
            },
        ]
    }
    messages = _build_message_history(
        transcript=transcript,
        current_message="Make it shorter",
    )
    assert len(messages) == 4
    assert isinstance(messages[0], SystemMessage)
    assert messages[1].content == "Draft a post"
    assert isinstance(messages[2], AIMessage)
    assert messages[2].content == "Here is the post."
    assert isinstance(messages[3], HumanMessage)
    assert messages[3].content == "Make it shorter"


def test_build_message_history_truncates_window() -> None:
    raw = []
    for i in range(50):
        role = "user" if i % 2 == 0 else "assistant"
        raw.append({"role": role, "parts": [{"type": "text", "text": f"Msg {i}"}]})
    transcript = {"messages": raw}

    messages = _build_message_history(
        transcript=transcript,
        current_message="Msg 49",
        max_history_messages=10,
    )
    assert len(messages) == 11
    assert isinstance(messages[0], SystemMessage)
    assert messages[-1].content == "Msg 49"


@pytest.mark.anyio
async def test_stream_text_smoothly() -> None:
    text = "Word one and word two"
    collected = []
    async for ev, data in _stream_text_smoothly(text, delay=0):
        assert ev == "text_delta"
        collected.append(data["content"])

    assert "".join(collected) == text
    assert len(collected) == 5  # 5 words/tokens


@pytest.mark.anyio
async def test_stream_parsed_chunks_thought_and_text() -> None:
    async def sample_chunks() -> AsyncGenerator[str, None]:
        yield "<thought>"
        yield "1. Plan the hook\n"
        yield "2. Formulate CTA</thought>\n\n"
        yield "Here is the final post."

    events = []
    async for ev, data in _stream_parsed_chunks(sample_chunks(), delay=0):
        events.append((ev, data))

    thought_deltas = [d["content"] for ev, d in events if ev == "thought"]
    text_deltas = [d["content"] for ev, d in events if ev == "text_delta"]

    assert "1. Plan the hook\n2. Formulate CTA" in "".join(thought_deltas)
    assert "".join(text_deltas).strip() == "Here is the final post."


@pytest.mark.anyio
async def test_default_chat_stream_runner_success() -> None:
    async def fake_astream(messages: Any) -> AsyncGenerator[AIMessageChunk, None]:
        assert len(messages) >= 2
        yield AIMessageChunk(
            content="<thought>Strategy: Use viral hook</thought>\nHere is the post!"
        )

    mock_model = MagicMock()
    mock_model.astream = fake_astream

    with (
        patch(
            "app.services.ai_chat_runner._stream_direct_openai_proxy",
            side_effect=ConnectionError("proxy down"),
        ),
        patch("app.services.ai_chat_runner.get_chat_model", return_value=mock_model),
    ):
        events = []
        async for ev, data in default_chat_stream_runner(
            message="Test prompt",
            thread_id="test-id",
            smooth_delay=0,
        ):
            events.append((ev, data))

    thoughts = [d["content"] for ev, d in events if ev == "thought"]
    assert len(thoughts) > 0
    assert "Strategy: Use viral hook" in "".join(thoughts)

    deltas = [d["content"] for ev, d in events if ev == "text_delta"]
    assert "".join(deltas).strip() == "Here is the post!"
    assert events[-1] == ("done", {})


@pytest.mark.anyio
async def test_default_chat_stream_runner_error() -> None:
    mock_model = MagicMock()
    mock_model.astream.side_effect = ConnectionError("Model endpoint unavailable")

    with (
        patch(
            "app.services.ai_chat_runner._stream_direct_openai_proxy",
            side_effect=ConnectionError("proxy down"),
        ),
        patch("app.services.ai_chat_runner.get_chat_model", return_value=mock_model),
    ):
        events = []
        async for ev, data in default_chat_stream_runner(
            message="Test prompt",
            thread_id="test-id",
            smooth_delay=0,
        ):
            events.append((ev, data))

    error_event = [d for ev, d in events if ev == "error"]
    assert len(error_event) == 1
    assert "LLM error" in error_event[0]["message"]
    assert events[-1] == ("done", {})
