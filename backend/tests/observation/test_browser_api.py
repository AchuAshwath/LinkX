import asyncio
import base64
import io
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Event
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pytest import FixtureRequest
from sqlmodel import Session

from app import crud
from app.api.routes import ai_browser_chat, ai_threads
from app.core.config import settings
from app.core.db import engine
from app.main import app
from app.models import ChatThread, User, UserCreate
from app.observation.model import ObservationModelError
from app.observation.schemas import BrowserNote, ReadinessResult
from app.services.ai_observation_budget import (
    ObservationInputBudget,
    ObservationInputBudgetError,
)
from tests.utils.utils import get_superuser_token_headers, random_email


def _jpeg_data_url() -> str:
    image = io.BytesIO()
    Image.new("RGB", (1, 1), (180, 20, 20)).save(image, format="JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(image.getvalue()).decode()


def _frame(frame_id: str = "frame-1", *, sequence: int = 1) -> dict[str, Any]:
    return {
        "id": frame_id,
        "sequence": sequence,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "width": 1,
        "height": 1,
        "image_data_url": _jpeg_data_url(),
    }


def _known_note() -> dict[str, Any]:
    return {
        "id": "known-note",
        "sequence": 1,
        "text": "A product page with specifications.",
        "model": "test-model",
        "uncertainty": "",
    }


def _body(
    *,
    pending: list[dict[str, Any]] | None = None,
    notes: list[dict[str, Any]] | None = None,
    request_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    return {
        "request_id": str(request_id or uuid.uuid4()),
        "message": "What is shown on this page?",
        "model": "test-model",
        "browser_context": {
            "session_id": str(uuid.uuid4()),
            "generation": 1,
            "cutoff": 20,
            "summary": "",
            "notes": notes or [],
            "pending_frames": pending or [],
            "current_view": None,
            "gap_count": 0,
        },
    }


def _event_data(response: Any, event_name: str) -> list[dict[str, Any]]:
    events = []
    for block in response.text.split("\n\n"):
        lines = block.splitlines()
        if len(lines) < 2 or lines[0] != f"event: {event_name}":
            continue
        events.append(json.loads(lines[1].removeprefix("data: ")))
    return events


def _answer_text(response: Any) -> str:
    return "".join(event["content"] for event in _event_data(response, "text_delta"))


def _thread_transcript(thread_id: uuid.UUID) -> dict[str, Any]:
    with Session(engine) as session:
        thread = session.get(ChatThread, thread_id)
        assert thread is not None
        return thread.transcript


@dataclass
class BrowserApiHarness:
    client: TestClient
    headers: dict[str, str]
    thread_id: uuid.UUID
    monkeypatch: pytest.MonkeyPatch
    streamed_provider: Any


@pytest.fixture
def browser_api_harness(request: FixtureRequest) -> BrowserApiHarness:
    return BrowserApiHarness(
        client=request.getfixturevalue("api_client"),
        headers=request.getfixturevalue("auth_headers"),
        thread_id=request.getfixturevalue("committed_thread"),
        monkeypatch=request.getfixturevalue("monkeypatch"),
        streamed_provider=request.getfixturevalue("streamed_provider"),
    )


def test_post_read_overflow_keeps_note_receipt_and_reports_actionable_budget_error(
    browser_api_harness: BrowserApiHarness,
) -> None:
    harness = browser_api_harness

    async def read(*, request: Any) -> BrowserNote:
        return BrowserNote(
            id=request.frame.id,
            sequence=request.frame.sequence,
            text="Useful retained page details.",
            model=request.model,
        )

    def preflight_readiness(*, request: Any) -> None:
        if request.context.notes:
            raise ObservationInputBudgetError(
                "not exposed raw",
                reason="input_too_large",
                budget=ObservationInputBudget("test-model", 4_000, 2_000, 2_000, 2_001),
            )

    harness.monkeypatch.setattr(ai_browser_chat.browser_model, "read", read)
    harness.monkeypatch.setattr(
        ai_browser_chat.browser_model, "preflight_readiness", preflight_readiness
    )
    response = harness.client.post(
        f"{settings.API_V1_STR}/ai/threads/{harness.thread_id}/browser-chat",
        headers=harness.headers,
        json=_body(pending=[_frame("retained-frame")]),
    )
    assert response.status_code == 200
    assert _event_data(response, "browser_receipt")[0]["completed_ids"] == [
        "retained-frame"
    ]
    assert _event_data(response, "text_delta") == []
    assert harness.streamed_provider.requests == []
    assert len(harness.streamed_provider.readiness_requests) == 1
    error = _event_data(response, "error")[0]
    assert "browser notes are retained" in error["message"]
    assert error["code"] == "input_too_large"
    assert error["budget"]["input_limit"] == 2_000
    assert "not exposed raw" not in response.text


def test_pending_frame_is_read_then_answered_without_persisting_browser_data(
    browser_api_harness: BrowserApiHarness,
) -> None:
    harness = browser_api_harness
    frame_id = "pending-frame"
    note_text = "The page asks for a shipping address."
    scripted = {"reads": 0}

    async def read(*, request: Any) -> BrowserNote:
        scripted["reads"] += 1
        return BrowserNote(
            id=request.frame.id,
            sequence=request.frame.sequence,
            text=note_text,
            model=request.model,
            uncertainty="",
        )

    harness.monkeypatch.setattr(ai_browser_chat.browser_model, "read", read)
    harness.streamed_provider.answer = "It asks for a shipping address."
    payload = _body(pending=[_frame(frame_id)])
    frame_data_url = payload["browser_context"]["pending_frames"][0]["image_data_url"]
    response = harness.client.post(
        f"{settings.API_V1_STR}/ai/threads/{harness.thread_id}/browser-chat",
        headers=harness.headers,
        json=payload,
    )

    assert response.status_code == 200
    assert scripted == {"reads": 1}
    assert len(harness.streamed_provider.readiness_requests) == 2
    assert _event_data(response, "browser_note")[0]["text"] == note_text
    receipt = _event_data(response, "browser_receipt")[0]
    assert receipt["completed_ids"] == [frame_id]
    assert receipt["failed_ids"] == []
    assert receipt["unused_ids"] == []
    assert _answer_text(response) == "It asks for a shipping address."

    transcript = _thread_transcript(harness.thread_id)
    messages = transcript["messages"]
    assert [message["role"] for message in messages] == ["user", "assistant"]
    serialized = json.dumps(transcript)
    assert "pending-frame" not in serialized
    assert note_text not in serialized
    assert payload["browser_context"]["session_id"] not in serialized
    assert frame_data_url not in serialized

    replay = harness.client.post(
        f"{settings.API_V1_STR}/ai/threads/{harness.thread_id}/browser-chat",
        headers=harness.headers,
        json=payload,
    )
    assert replay.status_code == 200
    assert _answer_text(replay) == "It asks for a shipping address."
    assert scripted == {"reads": 1}
    assert len(harness.streamed_provider.readiness_requests) == 2
    assert len(harness.streamed_provider.requests) == 1
    assert len(_thread_transcript(harness.thread_id)["messages"]) == 2


def test_answer_can_return_early_and_receipt_marks_pending_frames_unused(
    browser_api_harness: BrowserApiHarness,
) -> None:
    harness = browser_api_harness
    note = {
        "id": "existing-note",
        "sequence": 3,
        "text": "The page has a checkout button.",
        "model": "test-model",
        "uncertainty": "",
    }
    scripted = {"reads": 0}

    async def read(*, request: Any) -> BrowserNote:
        scripted["reads"] += 1
        assert request.frame.id == "unused-frame"
        raise AssertionError("early answer should leave this frame unused")

    harness.streamed_provider.answer = "There is a checkout button."
    harness.monkeypatch.setattr(ai_browser_chat.browser_model, "read", read)
    response = harness.client.post(
        f"{settings.API_V1_STR}/ai/threads/{harness.thread_id}/browser-chat",
        headers=harness.headers,
        json=_body(notes=[note], pending=[_frame("unused-frame", sequence=4)]),
    )

    assert response.status_code == 200
    assert scripted == {"reads": 0}
    assert len(harness.streamed_provider.readiness_requests) == 1
    assert _event_data(response, "browser_receipt")[0] == {
        "operation_id": json.loads(response.request.content)["request_id"],
        "completed_ids": [],
        "failed_ids": [],
        "unused_ids": ["unused-frame"],
    }
    assert _answer_text(response) == "There is a checkout button."
    transcript = _thread_transcript(harness.thread_id)
    assert [message["role"] for message in transcript["messages"]] == [
        "user",
        "assistant",
    ]
    assert note["text"] not in json.dumps(transcript)


def test_browser_route_requires_owner_auth_and_sanitizes_invalid_image(
    api_client: TestClient,
    auth_headers: dict[str, str],
    committed_thread: uuid.UUID,
) -> None:
    path = f"{settings.API_V1_STR}/ai/threads/{committed_thread}/browser-chat"
    payload = _body(pending=[_frame()])
    unauthorized = api_client.post(path, json=payload)
    assert unauthorized.status_code == 401

    email = random_email()
    password = "a-test-password-123"
    with Session(engine) as session:
        user = crud.create_user(
            session=session,
            user_create=UserCreate(email=email, password=password),
        )
        foreign_id = user.id
    login = api_client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={"username": email, "password": password},
    )
    foreign_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    forbidden = api_client.post(path, headers=foreign_headers, json=payload)
    assert forbidden.status_code == 403

    bad_body = _body(
        pending=[
            {
                **_frame("invalid-frame"),
                "image_data_url": "data:image/jpeg;base64,PRIVATE_IMAGE_MARKER",
            }
        ]
    )
    invalid = api_client.post(path, headers=auth_headers, json=bad_body)
    assert invalid.status_code == 422
    assert "PRIVATE_IMAGE_MARKER" not in invalid.text
    with Session(engine) as cleanup:
        user = cleanup.get(User, foreign_id)
        if user is not None:
            cleanup.delete(user)
            cleanup.commit()


def test_browser_body_limit_returns_413_before_json_validation(
    api_client: TestClient,
) -> None:
    thread_id = uuid.uuid4()
    oversized = b'{"padding":"' + b"x" * (8 * 1024 * 1024) + b'"}'
    response = api_client.post(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}/browser-chat",
        content=oversized,
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 413
    assert response.json() == {"detail": "Browser request exceeds size limit"}


def test_provider_failure_saves_no_assistant_message(
    api_client: TestClient,
    auth_headers: dict[str, str],
    committed_thread: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fail_readiness(*, request: Any) -> ReadinessResult:
        assert request.message == payload["message"]
        raise RuntimeError("scripted provider failure")

    monkeypatch.setattr(ai_browser_chat.browser_model, "prepare", fail_readiness)
    payload = _body()
    response = api_client.post(
        f"{settings.API_V1_STR}/ai/threads/{committed_thread}/browser-chat",
        headers=auth_headers,
        json=payload,
    )

    assert response.status_code == 200
    assert _event_data(response, "error") == [
        {
            "operation_id": payload["request_id"],
            "code": "evaluation_failed",
            "message": "Browser evidence preparation failed.",
        }
    ]
    messages = _thread_transcript(committed_thread)["messages"]
    assert [message["role"] for message in messages] == ["user"]
    assert payload["message"] in json.dumps(messages)


def test_readiness_failure_logs_only_safe_diagnostics(
    browser_api_harness: BrowserApiHarness,
    caplog: pytest.LogCaptureFixture,
) -> None:
    operation_id = uuid.uuid4()
    secret = "PRIVATE_EVALUATOR_PAYLOAD"

    async def fail_readiness(**_kwargs: Any) -> ReadinessResult:
        raise ObservationModelError("Observation model returned invalid readiness data")

    browser_api_harness.monkeypatch.setattr(
        ai_browser_chat.browser_model, "prepare", fail_readiness
    )
    body = _body(request_id=operation_id)
    body["message"] = secret
    response = browser_api_harness.client.post(
        f"{settings.API_V1_STR}/ai/threads/{browser_api_harness.thread_id}/browser-chat",
        headers=browser_api_harness.headers,
        json=body,
    )

    assert response.status_code == 200
    error = _event_data(response, "error")[0]
    assert error == {
        "operation_id": str(operation_id),
        "code": "evaluation_invalid_output",
        "message": "The browser readiness response was invalid.",
    }
    assert str(operation_id) in caplog.text
    assert "failure_code=evaluation_invalid_output" in caplog.text
    assert "exception_class=ObservationModelError" in caplog.text
    assert secret not in caplog.text


@pytest.mark.parametrize(
    ("exception", "failure_code", "message"),
    [
        (
            ObservationModelError("Observation model response was truncated"),
            "evaluation_truncated",
            "The browser readiness response was truncated.",
        ),
        (
            TimeoutError(),
            "evaluation_timeout",
            "Browser evidence preparation timed out.",
        ),
        (
            ObservationModelError("Observation model provider is unavailable"),
            "evaluation_provider_error",
            "The browser readiness provider is unavailable.",
        ),
    ],
)
def test_readiness_failures_have_stable_safe_sse_categories(
    browser_api_harness: BrowserApiHarness,
    exception: Exception,
    failure_code: str,
    message: str,
) -> None:
    operation_id = uuid.uuid4()

    async def fail_readiness(**_kwargs: Any) -> ReadinessResult:
        raise exception

    browser_api_harness.monkeypatch.setattr(
        ai_browser_chat.browser_model, "prepare", fail_readiness
    )
    response = browser_api_harness.client.post(
        f"{settings.API_V1_STR}/ai/threads/{browser_api_harness.thread_id}/browser-chat",
        headers=browser_api_harness.headers,
        json=_body(request_id=operation_id),
    )

    assert response.status_code == 200
    assert _event_data(response, "error")[0] == {
        "operation_id": str(operation_id),
        "code": failure_code,
        "message": message,
    }
    assert [
        message["role"]
        for message in _thread_transcript(browser_api_harness.thread_id)["messages"]
    ] == ["user"]


def test_transcript_save_failure_is_distinguished_and_does_not_leak_exception(
    browser_api_harness: BrowserApiHarness,
    caplog: pytest.LogCaptureFixture,
    streamed_provider: Any,
) -> None:
    operation_id = uuid.uuid4()
    secret = "PRIVATE_DATABASE_DETAIL"

    def fail_save(**_kwargs: Any) -> Any:
        raise RuntimeError(secret)

    streamed_provider.answer = "A general answer."
    browser_api_harness.monkeypatch.setattr(
        ai_browser_chat, "complete_transcript_turn", fail_save
    )
    response = browser_api_harness.client.post(
        f"{settings.API_V1_STR}/ai/threads/{browser_api_harness.thread_id}/browser-chat",
        headers=browser_api_harness.headers,
        json=_body(request_id=operation_id),
    )

    assert response.status_code == 200
    assert _answer_text(response) == "A general answer."
    assert _event_data(response, "error")[0] == {
        "operation_id": str(operation_id),
        "code": "transcript_unsaved",
        "message": "The browser answer could not be saved. Refresh the chat to check its saved answer.",
    }
    assert "phase=transcript_save" in caplog.text
    assert "exception_class=RuntimeError" in caplog.text
    assert secret not in caplog.text
    assert secret not in response.text
    assert [
        message["role"]
        for message in _thread_transcript(browser_api_harness.thread_id)["messages"]
    ] == ["user"]


def test_preflight_budget_rejection_creates_no_turn_or_model_calls(
    api_client: TestClient,
    auth_headers: dict[str, str],
    committed_thread: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = {"preflight": 0, "read": 0}

    def reject_budget(*, request: Any) -> None:
        assert request.message
        calls["preflight"] += 1
        raise ObservationInputBudgetError("test input cannot fit")

    async def read(*, request: Any) -> BrowserNote:
        assert request.frame.id == "over-budget-frame"
        calls["read"] += 1
        raise AssertionError("preflight must reject before reading a frame")

    monkeypatch.setattr(
        ai_browser_chat.browser_model,
        "preflight_readiness",
        reject_budget,
    )
    monkeypatch.setattr(ai_browser_chat.browser_model, "read", read)
    response = api_client.post(
        f"{settings.API_V1_STR}/ai/threads/{committed_thread}/browser-chat",
        headers=auth_headers,
        json=_body(pending=[_frame("over-budget-frame")]),
    )

    assert response.status_code == 422
    assert calls == {"preflight": 1, "read": 0}
    assert _thread_transcript(committed_thread)["messages"] == []


def test_normal_chat_is_blocked_while_browser_question_is_active(
    committed_thread: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
    streamed_provider: Any,
) -> None:
    browser_client = TestClient(app)
    normal_client = TestClient(app)
    headers = get_superuser_token_headers(browser_client)
    started = Event()
    release = Event()

    async def hold_readiness(*, request: Any) -> ReadinessResult:
        assert request.message == payload["message"]
        assert request.context.notes[0].id == "known-note"
        started.set()
        await asyncio.to_thread(release.wait, 5)
        return ReadinessResult(
            decision="ready",
            evidence_ids=["known-note"],
            answer_basis="browser",
            requires_complete=False,
        )

    async def fake_normal_stream(**kwargs: Any):
        assert kwargs["message"] == "Can you also answer this?"
        yield "text_delta", {"content": "Normal chat should be blocked."}
        yield "done", {}

    streamed_provider.answer = "Browser question finished."
    monkeypatch.setattr(ai_browser_chat.browser_model, "prepare", hold_readiness)
    monkeypatch.setattr(ai_threads, "default_chat_stream_runner", fake_normal_stream)
    payload = _body(notes=[_known_note()])
    browser_path = f"{settings.API_V1_STR}/ai/threads/{committed_thread}/browser-chat"
    normal_path = f"{settings.API_V1_STR}/ai/threads/{committed_thread}/chat"
    with ThreadPoolExecutor(max_workers=1) as pool:
        in_flight = pool.submit(
            browser_client.post,
            browser_path,
            headers=headers,
            json=payload,
        )
        assert started.wait(timeout=5)
        normal = normal_client.post(
            normal_path,
            headers=headers,
            json={"message": "Can you also answer this?", "model": "test-model"},
        )
        release.set()
        browser = in_flight.result(timeout=10)

    assert normal.status_code == 409
    assert browser.status_code == 200
    assert _answer_text(browser) == "Browser question finished."


def test_duplicate_http_request_cannot_release_active_browser_guard(
    committed_thread: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
    streamed_provider: Any,
) -> None:
    browser_client = TestClient(app)
    duplicate_client = TestClient(app)
    normal_client = TestClient(app)
    headers = get_superuser_token_headers(browser_client)
    started = Event()
    release = Event()
    payload = _body(notes=[_known_note()])

    async def hold_readiness(*, request: Any) -> ReadinessResult:
        assert request.message == payload["message"]
        assert request.context.notes[0].id == "known-note"
        started.set()
        await asyncio.to_thread(release.wait, 5)
        return ReadinessResult(
            decision="ready",
            evidence_ids=["known-note"],
            answer_basis="browser",
            requires_complete=False,
        )

    async def fake_normal_stream(**_: Any):
        yield "text_delta", {"content": "unreachable"}
        yield "done", {}

    streamed_provider.answer = "Done."
    monkeypatch.setattr(ai_browser_chat.browser_model, "prepare", hold_readiness)
    monkeypatch.setattr(ai_threads, "default_chat_stream_runner", fake_normal_stream)
    browser_path = f"{settings.API_V1_STR}/ai/threads/{committed_thread}/browser-chat"
    normal_path = f"{settings.API_V1_STR}/ai/threads/{committed_thread}/chat"
    with ThreadPoolExecutor(max_workers=1) as pool:
        in_flight = pool.submit(
            browser_client.post, browser_path, headers=headers, json=payload
        )
        assert started.wait(timeout=5)
        duplicate = duplicate_client.post(browser_path, headers=headers, json=payload)
        assert duplicate.status_code == 409
        normal = normal_client.post(
            normal_path,
            headers=headers,
            json={"message": "Another question", "model": "test-model"},
        )
        release.set()
        browser = in_flight.result(timeout=10)

    assert normal.status_code == 409
    assert browser.status_code == 200
