import asyncio
import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessageChunk
from sqlmodel import Session

from app.api.routes.ai_threads import (
    ChatStreamContext,
    _ensure_user_turn_saved,
    _generate_chat_events,
)
from app.core.config import settings
from app.models import ChatMessageRequest, ChatThread


@pytest.fixture(autouse=True)
def _mock_title_generator():
    with patch(
        "app.api.routes.ai_threads.generate_ai_thread_title",
        return_value="Mocked AI Title",
    ):
        yield


def _create_test_thread(
    *,
    client: TestClient,
    headers: dict[str, str],
    prompt: str = "Test prompt",
) -> str:
    res = client.post(
        f"{settings.API_V1_STR}/ai/threads/",
        headers=headers,
        json={"prompt": prompt, "origin": "manual"},
    )
    return str(res.json()["id"])


def _prepare_stream_context(
    *,
    session: Session,
    thread: ChatThread,
    user_id: str,
    message: str = "Hello",
) -> ChatStreamContext:
    req = ChatMessageRequest(message=message)
    _ensure_user_turn_saved(
        session=session,
        thread=thread,
        body=req,
        clean_images=[],
    )
    return ChatStreamContext(
        thread=thread,
        session=session,
        body=req,
        clean_images=[],
        user_id_str=user_id,
        effective_prompt=message,
    )


def _extract_assistant_text(msg: dict[str, Any]) -> str:
    return "".join(
        p.get("text", "")
        for p in msg.get("parts", [])
        if isinstance(p, dict) and p.get("type") == "text"
    )


@pytest.mark.anyio
async def test_mid_stream_cancellation_saves_partial_turn_with_stopped_notice(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    """Issue #120: Client disconnect mid-stream commits partial response with stopped marker."""
    tid = _create_test_thread(client=client, headers=superuser_token_headers)
    db_thread = db.get(ChatThread, uuid.UUID(tid))
    assert db_thread is not None

    async def fake_stream_runner(**_kwargs: Any):
        yield "text_delta", {"content": "Initial thoughts before abort. "}
        await asyncio.sleep(0.5)
        yield "text_delta", {"content": "More text that should never arrive."}

    ctx = _prepare_stream_context(session=db, thread=db_thread, user_id="user-123")
    with patch(
        "app.api.routes.ai_threads.default_chat_stream_runner",
        side_effect=fake_stream_runner,
    ):
        gen = _generate_chat_events(ctx=ctx)
        first_event = await gen.__anext__()
        assert "Initial thoughts" in first_event
        # Simulate client closing socket (GeneratorExit)
        await gen.aclose()

    db.refresh(db_thread)
    msgs = db_thread.transcript.get("messages", [])
    assert len(msgs) == 2, "Turn pairs must remain balanced"
    assistant_msg = msgs[1]
    assert assistant_msg["role"] == "assistant"
    assistant_text = _extract_assistant_text(assistant_msg)
    assert "Initial thoughts before abort." in assistant_text
    assert "*(Generation stopped by user)*" in assistant_text


@pytest.mark.anyio
async def test_early_disconnect_before_any_tokens_saves_stopped_notice(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    """Issue #120: Abort before any tokens emitted still saves assistant turn with stopped marker."""
    tid = _create_test_thread(client=client, headers=superuser_token_headers)
    db_thread = db.get(ChatThread, uuid.UUID(tid))
    assert db_thread is not None

    async def fake_delayed_runner(**_kwargs: Any):
        await asyncio.sleep(0.5)
        yield "text_delta", {"content": "Unreachable"}

    ctx = _prepare_stream_context(session=db, thread=db_thread, user_id="user-123")
    with patch(
        "app.api.routes.ai_threads.default_chat_stream_runner",
        side_effect=fake_delayed_runner,
    ):
        gen = _generate_chat_events(ctx=ctx)
        fetch_task = asyncio.create_task(gen.__anext__())
        await asyncio.sleep(0.02)
        fetch_task.cancel()
        try:
            await fetch_task
        except (asyncio.CancelledError, GeneratorExit, StopAsyncIteration):
            pass
        await gen.aclose()

    db.refresh(db_thread)
    msgs = db_thread.transcript.get("messages", [])
    assert len(msgs) == 2, "Orphaned user turn must be prevented"
    assistant_msg = msgs[1]
    assert assistant_msg["role"] == "assistant"
    assert _extract_assistant_text(assistant_msg) == "*(Generation stopped by user)*"


@pytest.mark.anyio
async def test_normal_stream_completion_does_not_add_stopped_marker(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    """Issue #120: Normal stream completion preserves full text without stopped notice."""
    tid = _create_test_thread(client=client, headers=superuser_token_headers)
    db_thread = db.get(ChatThread, uuid.UUID(tid))
    assert db_thread is not None

    async def fake_complete_runner(**_kwargs: Any):
        yield "text_delta", {"content": "Full completed generation."}

    ctx = _prepare_stream_context(session=db, thread=db_thread, user_id="user-123")
    with patch(
        "app.api.routes.ai_threads.default_chat_stream_runner",
        side_effect=fake_complete_runner,
    ):
        async for _ in _generate_chat_events(ctx=ctx):
            pass

    db.refresh(db_thread)
    msgs = db_thread.transcript.get("messages", [])
    assert len(msgs) == 2
    assistant_text = _extract_assistant_text(msgs[1])
    assert assistant_text == "Full completed generation."
    assert "*(Generation stopped by user)*" not in assistant_text


@pytest.mark.anyio
async def test_running_tools_marked_interrupted_with_stopped_notice(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    """Issue #120: Active running tool calls become interrupted and stopped marker appended."""
    tid = _create_test_thread(client=client, headers=superuser_token_headers)
    db_thread = db.get(ChatThread, uuid.UUID(tid))
    assert db_thread is not None

    async def fake_tool_runner(**_kwargs: Any):
        yield "tool_start", {"id": "call_1", "name": "scrape_tool", "input": {}}
        yield "text_delta", {"content": "Searching sources..."}
        await asyncio.sleep(0.5)

    ctx = _prepare_stream_context(session=db, thread=db_thread, user_id="user-123")
    with patch(
        "app.api.routes.ai_threads.default_chat_stream_runner",
        side_effect=fake_tool_runner,
    ):
        gen = _generate_chat_events(ctx=ctx)
        await gen.__anext__()  # tool_start
        await gen.__anext__()  # text_delta
        await gen.aclose()  # abort while tool is still running

    db.refresh(db_thread)
    msgs = db_thread.transcript.get("messages", [])
    assert len(msgs) == 2
    tool_parts = [p for p in msgs[1]["parts"] if p.get("type") == "tool-call"]
    assert len(tool_parts) == 1
    assert tool_parts[0]["state"] == "cancelled"
    assert tool_parts[0]["tool"]["state"] == "cancelled"
    text_parts = [p for p in msgs[1]["parts"] if p.get("type") == "text"]
    assert any("*(Generation stopped by user)*" in p["text"] for p in text_parts)


@pytest.mark.anyio
async def test_consecutive_aborts_maintain_balanced_turns_and_dag_linkage(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    """Adversarial: Multiple sequential aborts preserve alternating turn pairs and DAG parent links."""
    tid = _create_test_thread(client=client, headers=superuser_token_headers)
    db_thread = db.get(ChatThread, uuid.UUID(tid))
    assert db_thread is not None

    async def fake_aborted_runner(**_kwargs: Any):
        yield "text_delta", {"content": "Aborting shortly..."}
        await asyncio.sleep(0.5)

    async def fake_success_runner(**_kwargs: Any):
        yield "text_delta", {"content": "Finally succeeded."}

    # Turn 1: Aborted
    ctx1 = _prepare_stream_context(
        session=db, thread=db_thread, user_id="user-123", message="Prompt 1"
    )
    with patch(
        "app.api.routes.ai_threads.default_chat_stream_runner",
        side_effect=fake_aborted_runner,
    ):
        gen1 = _generate_chat_events(ctx=ctx1)
        await gen1.__anext__()
        await gen1.aclose()

    # Turn 2: Aborted
    db.refresh(db_thread)
    ctx2 = _prepare_stream_context(
        session=db, thread=db_thread, user_id="user-123", message="Prompt 2"
    )
    with patch(
        "app.api.routes.ai_threads.default_chat_stream_runner",
        side_effect=fake_aborted_runner,
    ):
        gen2 = _generate_chat_events(ctx=ctx2)
        await gen2.__anext__()
        await gen2.aclose()

    # Turn 3: Success
    db.refresh(db_thread)
    ctx3 = _prepare_stream_context(
        session=db, thread=db_thread, user_id="user-123", message="Prompt 3"
    )
    with patch(
        "app.api.routes.ai_threads.default_chat_stream_runner",
        side_effect=fake_success_runner,
    ):
        async for _ in _generate_chat_events(ctx=ctx3):
            pass

    db.refresh(db_thread)
    msgs = db_thread.transcript.get("messages", [])
    assert len(msgs) == 6, "Must contain exactly 3 turn pairs"

    expected_roles = ["user", "assistant", "user", "assistant", "user", "assistant"]
    assert [m["role"] for m in msgs] == expected_roles

    for i in range(1, 6):
        assert msgs[i]["parent_id"] == msgs[i - 1]["id"], f"Message {i} DAG link broken"

    assert msgs[1].get("interrupted") is True
    assert msgs[3].get("interrupted") is True
    assert msgs[5].get("interrupted") is not True
    assert db_thread.active_leaf_id == msgs[5]["id"]


@pytest.mark.anyio
async def test_stream_events_with_heartbeat_closes_runner_on_disconnect() -> None:
    """Adversarial: Closing heartbeat generator invokes runner.aclose() properly."""
    from app.api.routes.ai_threads import _stream_events_with_heartbeat

    closed = False

    async def sample_generator():
        nonlocal closed
        try:
            yield "text_delta", {"content": "Sample"}
            await asyncio.sleep(10)
        finally:
            closed = True

    gen = _stream_events_with_heartbeat(runner=sample_generator())
    first = await gen.__anext__()
    assert first == ("text_delta", {"content": "Sample"})
    await gen.aclose()

    assert closed is True, "Stream runner generator must be cleanly closed"


@pytest.mark.anyio
async def test_real_default_chat_stream_runner_cancellation_no_duplicate_turns(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    """Spec/Adversarial: Real default_chat_stream_runner with client abort saves exactly ONE assistant turn."""
    tid = _create_test_thread(client=client, headers=superuser_token_headers)
    db_thread = db.get(ChatThread, uuid.UUID(tid))
    assert db_thread is not None

    async def slow_astream(*_args: Any, **_kwargs: Any):
        yield AIMessageChunk(content="Partial token 1. ")
        await asyncio.sleep(0.5)
        yield AIMessageChunk(content="Unreachable token 2.")

    mock_model = MagicMock()
    mock_model.astream = slow_astream

    ctx = _prepare_stream_context(
        session=db,
        thread=db_thread,
        user_id=str(db_thread.owner_id),
        message="Real runner cancellation test",
    )

    with (
        patch(
            "app.services.agentic.agent_supervisor.build_bot_agent",
            side_effect=RuntimeError("bot disabled for direct stream test"),
        ),
        patch(
            "app.services.ai_completion_client.get_chat_model",
            return_value=mock_model,
        ),
        patch(
            "app.services.ai_completion_client.stream_direct_openai_proxy",
            side_effect=ConnectionError("proxy down"),
        ),
    ):
        gen = _generate_chat_events(ctx=ctx)
        first_event = await gen.__anext__()
        assert "Partial" in first_event
        # Client disconnects mid-stream
        await gen.aclose()

    db.refresh(db_thread)
    msgs = db_thread.transcript.get("messages", [])
    assert len(msgs) == 2, (
        "Must contain exactly 1 user turn and 1 assistant turn (no dual persistence)"
    )
    assert msgs[0]["role"] == "user"
    assert msgs[1]["role"] == "assistant"
    assert msgs[1].get("interrupted") is True
    assistant_text = _extract_assistant_text(msgs[1])
    assert "Partial" in assistant_text
    assert "*(Generation stopped by user)*" in assistant_text
