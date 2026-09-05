import asyncio
from collections.abc import AsyncGenerator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

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
    default_chat_stream_runner,
    format_sse,
)
from app.services.ai_stream_parser import (
    stream_parsed_chunks,
    stream_text_smoothly,
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
                "parts": [{"type": "text", "text": "Here is a draft"}],
            },
        ]
    }
    messages = _build_message_history(
        transcript=transcript,
        current_message="Make it shorter",
    )
    assert len(messages) == 4
    assert isinstance(messages[0], SystemMessage)
    assert isinstance(messages[1], HumanMessage)
    assert messages[1].content == "Draft a post"
    assert isinstance(messages[2], AIMessage)
    assert messages[2].content == "Here is a draft"
    assert isinstance(messages[3], HumanMessage)
    assert messages[3].content == "Make it shorter"


def test_build_message_history_preserves_draft_artifact_and_post_id() -> None:
    transcript = {
        "messages": [
            {
                "role": "user",
                "parts": [{"type": "text", "text": "Draft a post about LinkX"}],
            },
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "draft_artifact",
                        "artifact": {
                            "id": "post-uuid-1234",
                            "postId": "post-uuid-1234",
                            "content": "Why LinkX is the best tool for founders",
                            "platform": "x",
                        },
                    },
                    {"type": "text", "text": "I've drafted and saved the post above."},
                ],
            },
        ]
    }
    messages = _build_message_history(
        transcript=transcript,
        current_message="no make this more contreversial - this post",
    )
    assert len(messages) == 4
    ai_msg = messages[2]
    assert isinstance(ai_msg, AIMessage)
    assert "post-uuid-1234" in str(ai_msg.content)
    assert "Why LinkX is the best tool for founders" in str(ai_msg.content)
    assert "I've drafted and saved the post above." in str(ai_msg.content)


def test_build_message_history_truncates_window() -> None:
    # 50 existing turns -> should truncate to max 10 + 1 system
    long_messages = [
        {
            "role": "user" if i % 2 == 0 else "assistant",
            "parts": [{"type": "text", "text": f"Msg {i}"}],
        }
        for i in range(50)
    ]
    messages = _build_message_history(
        transcript={"messages": long_messages},
        current_message="Final message",
        max_history_messages=10,
    )
    assert len(messages) == 11
    assert isinstance(messages[0], SystemMessage)
    assert isinstance(messages[-1], HumanMessage)
    assert messages[-1].content == "Final message"


@pytest.mark.anyio
async def test_stream_text_smoothly() -> None:
    text = "Word one and word two"
    collected = []
    async for ev, data in stream_text_smoothly(text, delay=0):
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
    async for ev, data in stream_parsed_chunks(sample_chunks(), delay=0):
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
            "app.services.ai_completion_client.stream_direct_openai_proxy",
            side_effect=ConnectionError("proxy down"),
        ),
        patch(
            "app.services.ai_completion_client.get_chat_model",
            return_value=mock_model,
        ),
    ):
        events = []
        async for ev, data in default_chat_stream_runner(
            message="Test prompt",
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
            "app.services.ai_completion_client.stream_direct_openai_proxy",
            side_effect=ConnectionError("proxy down"),
        ),
        patch(
            "app.services.ai_completion_client.get_chat_model",
            return_value=mock_model,
        ),
    ):
        events = []
        async for ev, data in default_chat_stream_runner(
            message="Test prompt",
        ):
            events.append((ev, data))

    error_event = [d for ev, d in events if ev == "error"]
    assert len(error_event) == 1
    assert "LLM error" in error_event[0]["message"]
    assert events[-1] == ("done", {})


@pytest.mark.anyio
async def test_generate_ai_thread_title_success() -> None:
    from app.services.ai_chat_runner import generate_ai_thread_title

    mock_res = MagicMock()
    mock_res.content = '  "TypeScript 5.8 Deep Dive"  '
    mock_model = MagicMock()
    mock_model.ainvoke = AsyncMock(return_value=mock_res)

    with patch("app.services.ai_chat_runner.get_chat_model", return_value=mock_model):
        title = await generate_ai_thread_title(
            user_prompt="Explain TypeScript 5.8 features",
            assistant_response="TypeScript 5.8 introduces granular checks...",
        )
    assert title == "TypeScript 5.8 Deep Dive"


def test_build_message_history_with_images() -> None:
    valid_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    images = [valid_png, "https://example.com/photo.jpg"]
    messages = _build_message_history(
        transcript=None,
        current_message="Check these charts",
        images=images,
    )
    assert len(messages) == 2
    assert isinstance(messages[0], SystemMessage)
    last_msg = messages[1]
    assert isinstance(last_msg, HumanMessage)
    assert isinstance(last_msg.content, list)
    assert last_msg.content[0] == {"type": "text", "text": "Check these charts"}
    assert last_msg.content[1] == {
        "type": "image_url",
        "image_url": {"url": valid_png},
    }
    assert last_msg.content[2] == {
        "type": "image_url",
        "image_url": {"url": "https://example.com/photo.jpg"},
    }


def test_build_message_history_transcript_with_image_parts() -> None:
    transcript = {
        "messages": [
            {
                "role": "user",
                "parts": [
                    {"type": "text", "text": "Previous prompt"},
                    {
                        "type": "image_url",
                        "image_url": {"url": "https://example.com/old.png"},
                    },
                ],
            },
            {
                "role": "assistant",
                "parts": [
                    {"type": "text", "text": "Looks like an architecture diagram"}
                ],
            },
        ]
    }
    messages = _build_message_history(
        transcript=transcript,
        current_message="Can you improve it?",
    )
    assert len(messages) == 4
    first_human = messages[1]
    assert isinstance(first_human, HumanMessage)
    assert isinstance(first_human.content, list)
    assert first_human.content[0] == {"type": "text", "text": "Previous prompt"}
    assert first_human.content[1] == {
        "type": "image_url",
        "image_url": {"url": "https://example.com/old.png"},
    }
    assert isinstance(messages[2], AIMessage)
    assert isinstance(messages[3], HumanMessage)
    assert messages[3].content == "Can you improve it?"


def test_extract_images_from_parts_variations() -> None:
    from app.services.ai_chat_runner import _extract_images_from_parts

    parts = [
        {"type": "text", "text": "Some text"},
        {"type": "image_url", "image_url": {"url": "https://example.com/dict.png"}},
        {"type": "image_url", "image_url": "https://example.com/string.png"},
        {"type": "image", "url": "https://example.com/direct.png"},
        {"type": "image_url", "image_url": None},
        {"type": "other", "url": "https://example.com/ignored.png"},
    ]
    extracted = _extract_images_from_parts(parts)
    assert extracted == [
        "https://example.com/dict.png",
        "https://example.com/string.png",
        "https://example.com/direct.png",
    ]


@pytest.mark.anyio
async def test_default_chat_stream_runner_cancelled_persists_partial_turn() -> None:
    """Issue #120: Verify CancelledError flushes partial tokens with interrupted: True."""

    async def slow_stream(_messages: Any) -> AsyncGenerator[AIMessageChunk, None]:
        yield AIMessageChunk(
            content="<thought>Formulating post</thought>\nHere is part 1"
        )
        await asyncio.sleep(0.5)
        yield AIMessageChunk(content=" and part 2")

    mock_model = MagicMock()
    mock_model.astream = slow_stream
    mock_session = MagicMock()
    mock_thread = MagicMock()
    mock_thread.id = "thread-123"

    with (
        patch(
            "app.services.ai_completion_client.stream_direct_openai_proxy",
            side_effect=ConnectionError("proxy down"),
        ),
        patch(
            "app.services.ai_completion_client.get_chat_model",
            return_value=mock_model,
        ),
        patch("app.crud.append_message_to_transcript") as mock_append,
    ):
        gen = default_chat_stream_runner(
            message="Test cancellation",
            session=mock_session,
            thread=mock_thread,
        )

        async def consume() -> None:
            async for _ in gen:
                pass

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.05)
        task.cancel()

        with pytest.raises(asyncio.CancelledError):
            await task

        mock_append.assert_called_once()
        _, kwargs = mock_append.call_args
        persisted_msg = kwargs["message"]

        assert persisted_msg["role"] == "assistant"
        assert persisted_msg["interrupted"] is True
        part_types = [p["type"] for p in persisted_msg["parts"]]
        assert "thought" in part_types
        assert "text" in part_types
        text_parts = [p["text"] for p in persisted_msg["parts"] if p["type"] == "text"]
        assert any("part 1" in t for t in text_parts)


@pytest.mark.anyio
async def test_default_chat_stream_runner_generator_exit_persists_turn() -> None:
    """Issue #120: Verify generator close (aclose) persists turn with interrupted: True."""

    async def fake_stream(_messages: Any) -> AsyncGenerator[AIMessageChunk, None]:
        yield AIMessageChunk(content="First partial token")
        await asyncio.sleep(0.2)
        yield AIMessageChunk(content="Second token")

    mock_model = MagicMock()
    mock_model.astream = fake_stream
    mock_session = MagicMock()
    mock_thread = MagicMock()

    with (
        patch(
            "app.services.ai_completion_client.stream_direct_openai_proxy",
            side_effect=ConnectionError("proxy down"),
        ),
        patch(
            "app.services.ai_completion_client.get_chat_model",
            return_value=mock_model,
        ),
        patch("app.crud.append_message_to_transcript") as mock_append,
    ):
        gen = default_chat_stream_runner(
            message="Test aclose",
            session=mock_session,
            thread=mock_thread,
        )
        async for _ev, _data in gen:
            break
        await gen.aclose()

        mock_append.assert_called_once()
        _, kwargs = mock_append.call_args
        persisted_msg = kwargs["message"]
        assert persisted_msg["interrupted"] is True
        assert persisted_msg["role"] == "assistant"


def test_build_message_history_applies_context_budgeting() -> None:
    """Issue #119: Verify _build_message_history applies tool pruning and sliding window."""
    long_tool_output = "A" * 1000
    transcript = {
        "messages": [
            {
                "role": "user",
                "parts": [{"type": "text", "text": "Turn 1"}],
            },
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "tool_call",
                        "name": "search_trends",
                        "output": long_tool_output,
                    },
                    {"type": "text", "text": "Found trends"},
                ],
            },
            {
                "role": "user",
                "parts": [{"type": "text", "text": "Turn 2"}],
            },
            {
                "role": "assistant",
                "parts": [{"type": "text", "text": "Response 2"}],
            },
        ]
    }
    # Budget that forces pruning
    messages = _build_message_history(
        transcript=transcript,
        current_message="Turn 3",
        token_budget=50,
    )
    assert len(messages) >= 2
    assert isinstance(messages[0], SystemMessage)
    assert isinstance(messages[-1], HumanMessage)
    assert messages[-1].content == "Turn 3"


def test_build_message_history_malformed_transcript_resilience() -> None:
    """Adversarial Test: Verify build_message_history survives highly malformed transcripts without crashing."""
    malformed_variations: list[Any] = [
        None,
        {},
        {"messages": "not a list"},
        {"messages": [None, 123, "string", {}, {"parts": "not a list"}]},
        {"messages": [{"role": "user", "parts": [None, {"type": 999}]}]},
        {
            "messages": [
                {
                    "role": "assistant",
                    "parts": [None, 456, {"type": "text", "text": 123}],
                }
            ]
        },
        {
            "messages": [
                {"role": "assistant", "parts": [{"type": "tool_call", "output": None}]}
            ]
        },
    ]
    for bad_transcript in malformed_variations:
        result = _build_message_history(
            transcript=bad_transcript,
            current_message="Safe user prompt",
        )
        assert len(result) >= 2
        assert isinstance(result[0], SystemMessage)
        assert isinstance(result[-1], HumanMessage)
        assert result[-1].content == "Safe user prompt"


def test_tool_call_deduplication_and_output_update() -> None:
    """Adversarial Test: tool_output must update existing tool-call in-place rather than duplicating it."""
    from app.services.ai_chat_runner import _append_tool_call

    parts: list[dict[str, Any]] = []
    _append_tool_call(
        parts,
        event="tool_start",
        data={
            "id": "call_abc",
            "name": "save_draft_post",
            "input": {"content": "Post 1"},
        },
    )
    assert len(parts) == 1
    assert parts[0]["state"] == "running"
    assert parts[0]["tool"]["input"] == {"content": "Post 1"}

    _append_tool_call(
        parts,
        event="tool_output",
        data={
            "id": "call_abc",
            "name": "save_draft_post",
            "output": {"post_id": "p_123"},
        },
    )
    assert len(parts) == 1
    assert parts[0]["state"] == "completed"
    assert parts[0]["output"] == {"post_id": "p_123"}
    assert parts[0]["tool"]["input"] == {"content": "Post 1"}
    assert parts[0]["tool"]["output"] == {"post_id": "p_123"}


def test_persist_interrupted_turn_marks_running_tools_cancelled() -> None:
    """Adversarial Test: Interrupted turn must transition running tools to cancelled state."""
    from app.services.ai_chat_runner import _persist_interrupted_turn

    mock_session = MagicMock()
    mock_thread = MagicMock()
    mock_thread.id = "thread-xyz"

    parts: list[dict[str, Any]] = [
        {
            "type": "tool-call",
            "toolCallId": "call_in_progress",
            "name": "generate_media",
            "state": "running",
            "tool": {
                "id": "call_in_progress",
                "name": "generate_media",
                "state": "running",
            },
        }
    ]

    with patch("app.crud.append_message_to_transcript") as mock_append:
        _persist_interrupted_turn(
            session=mock_session,
            thread=mock_thread,
            thread_id=mock_thread.id,
            parts=parts,
        )

        mock_append.assert_called_once()
        _, kwargs = mock_append.call_args
        persisted_msg = kwargs["message"]

        assert persisted_msg["interrupted"] is True
        saved_part = persisted_msg["parts"][0]
        assert saved_part["state"] == "cancelled"
        assert saved_part["tool"]["state"] == "cancelled"
