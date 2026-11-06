"""Generation ownership and terminal-error behavior through the public stream runner."""

import asyncio
from collections.abc import AsyncGenerator
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from langchain_core.messages import AIMessageChunk

from app.services.ai_chat_runner import default_chat_stream_runner
from app.services.ai_stream_turn import StreamTurn, replay_stream_parts


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
    assert events[-1][0] == "error"
    assert not any(ev == "done" for ev, _ in events)


@pytest.mark.anyio
async def test_supervisor_error_after_first_event_is_terminal_without_fallback() -> (
    None
):
    async def events_with_partial_then_error(_input: Any, *, version: str):
        assert version == "v2"
        yield {
            "event": "on_chat_model_stream",
            "data": {"chunk": AIMessageChunk(content="Partial answer")},
        }
        raise RuntimeError("supervisor stream failed")

    agent = MagicMock()
    agent.astream_events = events_with_partial_then_error

    with (
        patch(
            "app.services.agentic.agent_supervisor.build_bot_agent",
            return_value=agent,
        ),
        patch(
            "app.services.ai_chat_runner.stream_raw_chat_completion"
        ) as direct_stream,
    ):
        events = [
            event
            async for event in default_chat_stream_runner(
                message="Answer this",
                user_id="user-1",
                session=MagicMock(),
            )
        ]

    assert any(name == "text_delta" for name, _ in events)
    assert [name for name, _ in events].count("error") == 1
    assert not any(name == "done" for name, _ in events)
    direct_stream.assert_not_called()


@pytest.mark.anyio
async def test_strict_no_fallback_reports_agent_setup_error() -> None:
    with (
        patch(
            "app.services.agentic.agent_supervisor.build_bot_agent",
            side_effect=RuntimeError("agent setup failed"),
        ),
        patch(
            "app.services.ai_chat_runner.stream_raw_chat_completion"
        ) as direct_stream,
    ):
        events = [
            event
            async for event in default_chat_stream_runner(
                message="Answer this",
                user_id="user-1",
                session=MagicMock(),
                strict_no_fallback=True,
            )
        ]

    assert [name for name, _ in events] == ["error"]
    direct_stream.assert_not_called()


@pytest.mark.anyio
async def test_default_chat_stream_runner_cancellation_does_not_persist_turn() -> None:
    """Transcript persistence belongs to the route, not the streaming runner."""

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

        mock_append.assert_not_called()


@pytest.mark.anyio
async def test_default_chat_stream_runner_generator_exit_does_not_persist_turn() -> (
    None
):
    """Generator close is propagated to the route, the sole persistence owner."""

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

        mock_append.assert_not_called()


@pytest.mark.anyio
async def test_handled_tool_error_closes_the_call_without_leaking_raw_error() -> None:
    from app.services.ai_chat_runner import stream_agent_events

    class Agent:
        async def astream_events(self, _input: Any, *, version: str):
            assert version == "v2"
            yield {
                "event": "on_tool_start",
                "run_id": "broken",
                "name": "lookup",
                "data": {"input": {}},
            }
            yield {
                "event": "on_tool_error",
                "run_id": "broken",
                "name": "lookup",
                "data": {"error": RuntimeError("private backend detail")},
            }
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": AIMessageChunk(content="Recovered answer.")},
            }

    events = [
        event
        async for event in stream_agent_events(
            agent=Agent(), messages=[], promote_thought_fallback=False
        )
    ]
    outputs = [data for kind, data in events if kind == "tool_output"]
    assert outputs == [
        {
            "id": "broken",
            "name": "lookup",
            "output": {"error": "The tool could not complete."},
        }
    ]
    turn = StreamTurn()
    for kind, data in events:
        turn.record(kind, data)
    parts = turn.parts_snapshot()
    assert parts[0]["state"] == "failed"
    assert parts[0]["tool"]["state"] == "failed"
    assert turn.text == "Recovered answer."
    replay = list(replay_stream_parts(parts=parts))
    assert [data for kind, data in replay if kind == "tool_output"] == outputs
    assert "private backend detail" not in str(parts)
