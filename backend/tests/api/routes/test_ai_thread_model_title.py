import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessageChunk
from sqlmodel import Session

from app.api.routes.ai_threads import AssistantTurnPayload, _save_assistant_turn
from app.core.config import settings
from app.models import ChatMessageRequest, ChatThread


def _create_thread(
    client: TestClient,
    headers: dict[str, str],
    *,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body = {"origin": "manual", **(payload or {})}
    response = client.post(
        f"{settings.API_V1_STR}/ai/threads/", headers=headers, json=body
    )
    return response.json()


def _patch_thread(
    client: TestClient,
    headers: dict[str, str],
    thread_id: str,
    payload: dict[str, Any],
) -> Any:
    return client.patch(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}",
        headers=headers,
        json=payload,
    )


async def _run_assistant_turn_with_title_patch(
    *,
    session: Session,
    db_thread: ChatThread,
    ai_title: str,
) -> None:
    payload = AssistantTurnPayload(
        body=ChatMessageRequest(message="Conversation prompt"),
        accumulated_text="Assistant output text",
        assistant_parts=[{"type": "text", "text": "Assistant output text"}],
    )
    with patch(
        "app.api.routes.ai_threads.generate_ai_thread_title",
        return_value=ai_title,
    ):
        await _save_assistant_turn(session=session, thread=db_thread, payload=payload)
    session.refresh(db_thread)


def _call_stream_with_fake_llm(
    client: TestClient,
    headers: dict[str, str],
    thread_id: uuid.UUID,
    payload: dict[str, Any],
) -> int:
    async def fake_astream(messages: Any):  # noqa: ARG001
        yield AIMessageChunk(content="Model response")

    mock_model = MagicMock()
    mock_model.astream = fake_astream

    with (
        patch(
            "app.services.agentic.agent_supervisor.build_bot_agent",
            side_effect=RuntimeError("bot agent disabled for unit test"),
        ),
        patch(
            "app.services.ai_completion_client.stream_direct_openai_proxy",
            side_effect=ConnectionError("proxy down"),
        ),
        patch(
            "app.services.ai_completion_client.get_chat_model",
            return_value=mock_model,
        ),
    ):
        res = client.post(
            f"{settings.API_V1_STR}/ai/threads/{thread_id}/chat",
            headers=headers,
            json=payload,
        )
    return res.status_code


def test_create_chat_thread_model_persistence(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Issue #126: Creating a thread with model persists in DB and returns in response."""
    data = _create_thread(
        client,
        superuser_token_headers,
        payload={"prompt": "Test model thread", "model": "gpt-5.5"},
    )
    assert data["model"] == "gpt-5.5"

    thread_db = db.get(ChatThread, uuid.UUID(data["id"]))
    assert thread_db is not None
    assert thread_db.model == "gpt-5.5"


def test_create_chat_thread_model_length_validation(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """Issue #126: Model name exceeding max_length=100 is rejected with 422."""
    res = client.post(
        f"{settings.API_V1_STR}/ai/threads/",
        headers=superuser_token_headers,
        json={"prompt": "Test model too long", "model": "m" * 101},
    )
    assert res.status_code == 422


@pytest.mark.parametrize(
    "case",
    [
        {
            "body": {"title": "Renamed Title", "model": "gpt-5.6-sol"},
            "title": "Renamed Title",
            "model": "gpt-5.6-sol",
            "custom": True,
        },
        {
            "body": {"model": "gpt-5.6-luna"},
            "title": "Original Title",
            "model": "gpt-5.6-luna",
            "custom": False,
        },
    ],
)
def test_patch_chat_thread_variations(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
    case: dict[str, Any],
) -> None:
    """Issue #126: PATCH persists model and accurately flags is_custom_title."""
    thread = _create_thread(
        client, superuser_token_headers, payload={"prompt": "Original Title"}
    )
    tid = thread["id"]

    res = _patch_thread(client, superuser_token_headers, tid, case["body"])
    assert res.status_code == 200

    thread_db = db.get(ChatThread, uuid.UUID(tid))
    assert thread_db is not None
    assert thread_db.title == case["title"]
    assert thread_db.model == case["model"]
    assert thread_db.is_custom_title is case["custom"]


def test_patch_thread_empty_whitespace_title_rejected(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Issue #126: Whitespace title must fail validation and preserve state."""
    thread = _create_thread(
        client, superuser_token_headers, payload={"prompt": "Valid Title"}
    )
    tid = thread["id"]

    res = _patch_thread(client, superuser_token_headers, tid, {"title": "   "})
    assert res.status_code in (400, 422)

    thread_db = db.get(ChatThread, uuid.UUID(tid))
    assert thread_db is not None
    assert thread_db.title == "Valid Title"
    assert thread_db.is_custom_title is False


@pytest.mark.anyio
@pytest.mark.parametrize(
    "case",
    [
        {
            "custom": True,
            "initial": "User Defined Title",
            "expected": "User Defined Title",
        },
        {
            "custom": False,
            "initial": "Initial Prompt",
            "expected": "AI Generated Title",
        },
    ],
)
async def test_ai_title_generation_eligibility(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
    case: dict[str, Any],
) -> None:
    """Issue #126: Protect custom titles from AI overwrite and allow generation when eligible."""
    thread_obj = _create_thread(
        client, superuser_token_headers, payload={"prompt": "Seed Prompt"}
    )
    tid = uuid.UUID(thread_obj["id"])
    db_thread = db.get(ChatThread, tid)
    assert db_thread is not None
    db_thread.title = case["initial"]
    db_thread.is_custom_title = case["custom"]
    db_thread.message_count = 1
    db.add(db_thread)
    db.commit()

    await _run_assistant_turn_with_title_patch(
        session=db, db_thread=db_thread, ai_title="AI Generated Title"
    )

    assert db_thread.title == case["expected"]
    assert db_thread.is_custom_title is case["custom"]


@pytest.mark.anyio
async def test_ai_title_race_condition_does_not_clobber_concurrent_manual_rename(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Issue #126: If thread is renamed during async title generation, AI title does not overwrite it."""
    thread_obj = _create_thread(
        client, superuser_token_headers, payload={"prompt": "Race Test Prompt"}
    )
    tid = uuid.UUID(thread_obj["id"])
    db_thread = db.get(ChatThread, tid)
    assert db_thread is not None

    async def fake_slow_generate(*_args: Any, **_kwargs: Any) -> str:
        db_thread.title = "User Renamed Concurrently"
        db_thread.is_custom_title = True
        db.add(db_thread)
        db.commit()
        return "Stale AI Title"

    payload = AssistantTurnPayload(
        body=ChatMessageRequest(message="Race Test Prompt"),
        accumulated_text="Race test response",
        assistant_parts=[{"type": "text", "text": "Race test response"}],
    )
    with patch(
        "app.api.routes.ai_threads.generate_ai_thread_title",
        side_effect=fake_slow_generate,
    ):
        await _save_assistant_turn(session=db, thread=db_thread, payload=payload)
    db.refresh(db_thread)

    assert db_thread.title == "User Renamed Concurrently"
    assert db_thread.is_custom_title is True


@pytest.mark.parametrize(
    "case",
    [
        {"initial": None, "stream": "gpt-5.5", "expected": "gpt-5.5"},
        {"initial": "gpt-5.5", "stream": None, "expected": "gpt-5.5"},
    ],
)
def test_chat_stream_model_persistence_and_preservation(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
    case: dict[str, Any],
) -> None:
    """Issue #126: chat_stream updates model when provided and preserves existing model when omitted."""
    thread = _create_thread(
        client,
        superuser_token_headers,
        payload={"prompt": "Stream Model Test", "model": case["initial"]},
    )
    tid = uuid.UUID(thread["id"])

    chat_payload: dict[str, Any] = {"message": "Hello from stream test"}
    if case["stream"] is not None:
        chat_payload["model"] = case["stream"]

    status_code = _call_stream_with_fake_llm(
        client, superuser_token_headers, tid, chat_payload
    )
    assert status_code == 200

    db_thread = db.get(ChatThread, tid)
    assert db_thread is not None
    assert db_thread.model == case["expected"]
