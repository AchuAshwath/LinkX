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
    prompt: str | None = None,
    origin: str = "manual",
) -> dict[str, Any]:
    body: dict[str, Any] = {"origin": origin}
    if prompt is not None:
        body["prompt"] = prompt
    response = client.post(
        f"{settings.API_V1_STR}/ai/threads/", headers=headers, json=body
    )
    return response.json()


def _mock_chat_stream_services(mock_model: Any) -> tuple[Any, Any, Any]:
    return (
        patch(
            "app.services.agentic.agent_supervisor.build_copilot_agent",
            side_effect=RuntimeError("copilot agent disabled for unit test"),
        ),
        patch(
            "app.services.ai_completion_client.stream_direct_openai_proxy",
            side_effect=ConnectionError("proxy down"),
        ),
        patch(
            "app.services.ai_completion_client.get_chat_model",
            return_value=mock_model,
        ),
    )


def test_create_chat_thread_model_persistence(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Issue #126: Creating a thread with model persists in DB and returns in response."""
    res = client.post(
        f"{settings.API_V1_STR}/ai/threads/",
        headers=superuser_token_headers,
        json={"prompt": "Test model thread", "model": "gpt-5.5"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["model"] == "gpt-5.5"

    thread_db = db.get(ChatThread, uuid.UUID(data["id"]))
    assert thread_db is not None
    assert thread_db.model == "gpt-5.5"


def test_update_chat_thread_model_and_custom_title_flag(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Issue #126: Updating title sets is_custom_title and updating model persists."""
    thread = _create_thread(client, superuser_token_headers, prompt="Original Title")
    tid = thread["id"]
    assert thread.get("is_custom_title") is False

    patch_res = client.patch(
        f"{settings.API_V1_STR}/ai/threads/{tid}",
        headers=superuser_token_headers,
        json={"title": "Manually Renamed Title", "model": "gpt-5.6-sol"},
    )
    assert patch_res.status_code == 200
    patched_data = patch_res.json()
    assert patched_data["title"] == "Manually Renamed Title"
    assert patched_data["model"] == "gpt-5.6-sol"
    assert patched_data["is_custom_title"] is True

    thread_db = db.get(ChatThread, uuid.UUID(tid))
    assert thread_db is not None
    assert thread_db.title == "Manually Renamed Title"
    assert thread_db.model == "gpt-5.6-sol"
    assert thread_db.is_custom_title is True


@pytest.mark.anyio
async def test_custom_title_protected_from_ai_title_overwrite(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Issue #126: When is_custom_title is True, assistant turn does not overwrite title."""
    thread_obj = _create_thread(
        client, superuser_token_headers, prompt="Initial Prompt"
    )
    tid = uuid.UUID(thread_obj["id"])
    db_thread = db.get(ChatThread, tid)
    assert db_thread is not None
    db_thread.title = "Protected Custom Title"
    db_thread.is_custom_title = True
    db_thread.message_count = 1
    db.add(db_thread)
    db.commit()
    db.refresh(db_thread)

    payload = AssistantTurnPayload(
        body=ChatMessageRequest(message="Initial Prompt"),
        accumulated_text="Generated Assistant Response",
        assistant_parts=[{"type": "text", "text": "Generated Assistant Response"}],
    )
    with patch(
        "app.api.routes.ai_threads.generate_ai_thread_title",
        return_value="AI Generated Title",
    ):
        await _save_assistant_turn(session=db, thread=db_thread, payload=payload)
    db.refresh(db_thread)

    assert db_thread.title == "Protected Custom Title"
    assert db_thread.is_custom_title is True


def test_chat_stream_persists_selected_model_to_thread(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Issue #126: chat_stream updates and persists thread.model."""

    async def fake_astream(messages: Any):  # noqa: ARG001
        yield AIMessageChunk(content="Model response")

    mock_model = MagicMock()
    mock_model.astream = fake_astream

    thread = _create_thread(client, superuser_token_headers, prompt="Stream Model Test")
    tid = uuid.UUID(thread["id"])

    p1, p2, p3 = _mock_chat_stream_services(mock_model)
    with p1, p2, p3:
        response = client.post(
            f"{settings.API_V1_STR}/ai/threads/{tid}/chat",
            headers=superuser_token_headers,
            json={"message": "Hello from model test", "model": "gpt-5.5"},
        )
    assert response.status_code == 200

    db_thread = db.get(ChatThread, tid)
    assert db_thread is not None
    assert db_thread.model == "gpt-5.5"


@pytest.mark.anyio
async def test_ai_title_generates_when_custom_title_is_false(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Issue #126: When is_custom_title is False and message_count <= 2, title is updated by AI."""
    thread_obj = _create_thread(
        client, superuser_token_headers, prompt="Initial Auto Prompt"
    )
    tid = uuid.UUID(thread_obj["id"])
    db_thread = db.get(ChatThread, tid)
    assert db_thread is not None
    assert db_thread.is_custom_title is False

    payload = AssistantTurnPayload(
        body=ChatMessageRequest(message="Initial Auto Prompt"),
        accumulated_text="Assistant response on topic",
        assistant_parts=[{"type": "text", "text": "Assistant response on topic"}],
    )
    with patch(
        "app.api.routes.ai_threads.generate_ai_thread_title",
        return_value="AI Generated Thread Title",
    ):
        await _save_assistant_turn(session=db, thread=db_thread, payload=payload)
    db.refresh(db_thread)

    assert db_thread.title == "AI Generated Thread Title"
    assert db_thread.is_custom_title is False


@pytest.mark.anyio
async def test_ai_title_race_condition_does_not_clobber_concurrent_manual_rename(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Issue #126: If thread is manually renamed during async title generation, AI title does not overwrite it."""
    thread_obj = _create_thread(
        client, superuser_token_headers, prompt="Race Test Prompt"
    )
    tid = uuid.UUID(thread_obj["id"])
    db_thread = db.get(ChatThread, tid)
    assert db_thread is not None
    assert db_thread.is_custom_title is False

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


def test_patch_thread_model_only_preserves_custom_title_false(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Issue #126: Updating only the model via PATCH must NOT mark is_custom_title as True."""
    thread = _create_thread(client, superuser_token_headers, prompt="Model Only Test")
    tid = thread["id"]
    assert thread.get("is_custom_title") is False

    patch_res = client.patch(
        f"{settings.API_V1_STR}/ai/threads/{tid}",
        headers=superuser_token_headers,
        json={"model": "gpt-5.6-luna"},
    )
    assert patch_res.status_code == 200
    patched_data = patch_res.json()
    assert patched_data["model"] == "gpt-5.6-luna"
    assert patched_data["is_custom_title"] is False

    thread_db = db.get(ChatThread, uuid.UUID(tid))
    assert thread_db is not None
    assert thread_db.model == "gpt-5.6-luna"
    assert thread_db.is_custom_title is False


def test_patch_thread_empty_whitespace_title_rejected_and_state_preserved(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Issue #126: Empty/whitespace title must fail validation and not change state."""
    thread = _create_thread(
        client, superuser_token_headers, prompt="Valid Initial Title"
    )
    tid = thread["id"]
    initial_title = thread["title"]

    patch_res = client.patch(
        f"{settings.API_V1_STR}/ai/threads/{tid}",
        headers=superuser_token_headers,
        json={"title": "    "},
    )
    assert patch_res.status_code in (400, 422)

    thread_db = db.get(ChatThread, uuid.UUID(tid))
    assert thread_db is not None
    assert thread_db.title == initial_title
    assert thread_db.is_custom_title is False


def test_chat_stream_preserves_existing_model_when_request_model_is_none(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Issue #126: chat_stream without model parameter does not wipe out previously set thread.model."""

    async def fake_astream(messages: Any):  # noqa: ARG001
        yield AIMessageChunk(content="Response")

    mock_model = MagicMock()
    mock_model.astream = fake_astream

    res = client.post(
        f"{settings.API_V1_STR}/ai/threads/",
        headers=superuser_token_headers,
        json={"prompt": "Preserve Model Test", "model": "gpt-5.5"},
    )
    tid = uuid.UUID(res.json()["id"])

    p1, p2, p3 = _mock_chat_stream_services(mock_model)
    with p1, p2, p3:
        stream_res = client.post(
            f"{settings.API_V1_STR}/ai/threads/{tid}/chat",
            headers=superuser_token_headers,
            json={"message": "Chatting without specifying model"},
        )
    assert stream_res.status_code == 200

    db_thread = db.get(ChatThread, tid)
    assert db_thread is not None
    assert db_thread.model == "gpt-5.5"


def test_create_chat_thread_model_length_validation(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """Issue #126: Model name exceeding max_length=100 is rejected with 422."""
    too_long_model = "m" * 101
    res = client.post(
        f"{settings.API_V1_STR}/ai/threads/",
        headers=superuser_token_headers,
        json={"prompt": "Test model too long", "model": too_long_model},
    )
    assert res.status_code == 422
