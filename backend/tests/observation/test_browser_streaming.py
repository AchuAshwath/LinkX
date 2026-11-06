"""Browser HTTP acceptance through the real agent with a scripted model transport."""

from uuid import UUID

from sqlmodel import Session

from app.core.db import engine
from app.observation.persistence import (
    CompletionPayload,
    TranscriptTurnRequest,
    begin_transcript_turn,
    complete_transcript_turn,
)
from tests.observation.test_browser_api import _body, _event_data
from tests.observation.test_browser_api import (
    browser_api_harness as _browser_api_harness,
)

browser_api_harness = _browser_api_harness


def test_browser_answer_streams_real_chunks_and_replays_without_generation(
    browser_api_harness,
    streamed_provider,
) -> None:
    harness = browser_api_harness
    payload = _body(
        notes=[
            {
                "id": "code-view",
                "sequence": 1,
                "text": "The code is SAPPHIRE-742.",
                "model": "test-model",
            }
        ]
    )
    streamed_provider.answer = "The code is SAPPHIRE-742."
    endpoint = f"/api/v1/ai/threads/{harness.thread_id}/browser-chat"
    response = harness.client.post(endpoint, headers=harness.headers, json=payload)
    assert response.status_code == 200
    assert [event["content"] for event in _event_data(response, "text_delta")] == [
        "The code is ",
        "SAPPHIRE-742.",
    ]
    assert _event_data(response, "error") == []
    assert len(streamed_provider.requests) == 1
    saved = harness.client.get(
        f"/api/v1/ai/threads/{harness.thread_id}", headers=harness.headers
    ).json()
    assert [message["role"] for message in saved["transcript"]["messages"]] == [
        "user",
        "assistant",
    ]
    assert saved["transcript"]["messages"][1]["parts"] == [
        {"type": "text", "text": "The code is SAPPHIRE-742."}
    ]
    replay = harness.client.post(endpoint, headers=harness.headers, json=payload)
    assert (
        "".join(event["content"] for event in _event_data(replay, "text_delta"))
        == "The code is SAPPHIRE-742."
    )
    assert len(streamed_provider.requests) == 1


def test_completed_browser_replay_preserves_tool_parts_without_executing_them(
    browser_api_harness,
    streamed_provider,
) -> None:
    harness = browser_api_harness
    payload = _body()
    turn = TranscriptTurnRequest(
        thread_id=harness.thread_id,
        request_id=UUID(payload["request_id"]),
        user_text=payload["message"],
        model=payload["model"],
    )
    parts = [
        {
            "type": "tool-call",
            "toolCallId": "saved-tool",
            "name": "get_social_account_status",
            "state": "completed",
            "tool": {
                "id": "saved-tool",
                "name": "get_social_account_status",
                "state": "completed",
                "input": {},
                "output": {"connected": True},
            },
        },
        {"type": "text", "text": "Your account is connected."},
    ]
    with Session(engine) as session:
        begin_transcript_turn(session=session, request=turn)
        complete_transcript_turn(
            session=session,
            request=turn,
            completion=CompletionPayload(
                answer="Your account is connected.",
                parts=parts,
                cancelled=lambda: False,
            ),
        )
    response = harness.client.post(
        f"/api/v1/ai/threads/{harness.thread_id}/browser-chat",
        headers=harness.headers,
        json=payload,
    )
    assert response.status_code == 200
    assert _event_data(response, "tool_start") == [
        {"id": "saved-tool", "name": "get_social_account_status", "input": {}}
    ]
    assert _event_data(response, "tool_output") == [
        {
            "id": "saved-tool",
            "name": "get_social_account_status",
            "output": {"connected": True},
        }
    ]
    assert _event_data(response, "text_delta") == [
        {"content": "Your account is connected."}
    ]
    assert streamed_provider.requests == []


def test_browser_stream_failure_saves_one_interrupted_partial_and_never_restarts(
    browser_api_harness,
    streamed_provider,
) -> None:
    harness = browser_api_harness
    streamed_provider.answer = "The code is SAPPHIRE-742."
    streamed_provider.fail_after_first = True
    payload = _body(
        notes=[
            {
                "id": "code-view",
                "sequence": 1,
                "text": "The code is SAPPHIRE-742.",
                "model": "test-model",
            }
        ]
    )
    endpoint = f"/api/v1/ai/threads/{harness.thread_id}/browser-chat"
    response = harness.client.post(endpoint, headers=harness.headers, json=payload)
    assert _event_data(response, "text_delta") == [{"content": "The code is "}]
    assert len(_event_data(response, "error")) == 1
    assert "event: done" not in response.text
    assert "scripted answer stream failure" not in response.text
    saved = harness.client.get(
        f"/api/v1/ai/threads/{harness.thread_id}", headers=harness.headers
    ).json()
    messages = saved["transcript"]["messages"]
    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert messages[1]["interrupted"] is True
    assert messages[1]["parts"] == [{"type": "text", "text": "The code is "}]
    assert len(streamed_provider.requests) == 1
    replay = harness.client.post(endpoint, headers=harness.headers, json=payload)
    assert replay.status_code == 409
    assert len(streamed_provider.requests) == 1
