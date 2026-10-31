import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.routes import ai_browser_chat, ai_threads
from app.core.config import settings
from app.main import app
from app.observation.schemas import EvaluationResult
from tests.observation.test_browser_api import _body, _event_data, _known_note


def test_browser_chat_titles_first_turn_and_preserves_manual_rename(
    api_client: TestClient,
    auth_headers: dict[str, str],
    committed_thread: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def evaluate(*, request: Any) -> EvaluationResult:
        assert request.message == "What is shown on this page?"
        assert request.context.notes
        return EvaluationResult(
            decision="answer",
            answer="A product page.",
            evidence_ids=[request.context.notes[0].id],
        )

    monkeypatch.setattr(ai_browser_chat.browser_model, "evaluate", evaluate)
    generated_titles: list[str] = []

    async def generate_title(
        *, user_prompt: str, assistant_response: str, model: str
    ) -> str:
        assert assistant_response == "A product page."
        assert model == "test-model"
        generated_titles.append(user_prompt)
        await asyncio.sleep(0.1)
        return "Generated browser title"

    monkeypatch.setattr(ai_threads, "generate_ai_thread_title", generate_title)
    path = f"{settings.API_V1_STR}/ai/threads/{committed_thread}"
    response = api_client.post(
        f"{path}/browser-chat",
        headers=auth_headers,
        json=_body(notes=[_known_note()]),
    )

    assert response.status_code == 200
    assert _event_data(response, "text_delta")[0]["content"] == "A product page."
    assert _event_data(response, "done") == [{}]
    assert generated_titles == ["What is shown on this page?"]
    detail = api_client.get(path, headers=auth_headers).json()
    assert [message["role"] for message in detail["transcript"]["messages"]] == [
        "user",
        "assistant",
    ]
    assert detail["title"] == "Generated browser title"

    renamed = api_client.patch(
        path,
        headers=auth_headers,
        json={"title": "My chosen title"},
    )
    assert renamed.status_code == 200
    followup = api_client.post(
        f"{path}/browser-chat",
        headers=auth_headers,
        json=_body(request_id=uuid.uuid4()),
    )

    assert followup.status_code == 200
    detail = api_client.get(path, headers=auth_headers).json()
    assert detail["title"] == "My chosen title"
    assert generated_titles == ["What is shown on this page?"]


def test_browser_title_generation_does_not_overwrite_concurrent_manual_rename(
    api_client: TestClient,
    auth_headers: dict[str, str],
    committed_thread: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def evaluate(*, request: Any) -> EvaluationResult:
        return EvaluationResult(
            decision="answer",
            answer="A product page.",
            evidence_ids=[request.context.notes[0].id],
        )

    title_started = Event()
    release_title = Event()

    async def generate_title(
        *, user_prompt: str, assistant_response: str, model: str
    ) -> str:
        assert user_prompt == "What is shown on this page?"
        assert assistant_response == "A product page."
        assert model == "test-model"
        title_started.set()
        await asyncio.to_thread(release_title.wait, 5)
        return "Generated browser title"

    monkeypatch.setattr(ai_browser_chat.browser_model, "evaluate", evaluate)
    monkeypatch.setattr(ai_threads, "generate_ai_thread_title", generate_title)
    title_client = TestClient(app)
    path = f"{settings.API_V1_STR}/ai/threads/{committed_thread}"

    with ThreadPoolExecutor(max_workers=1) as pool:
        response_task = pool.submit(
            title_client.post,
            f"{path}/browser-chat",
            headers=auth_headers,
            json=_body(notes=[_known_note()]),
        )
        assert title_started.wait(timeout=5)
        renamed = api_client.patch(
            path,
            headers=auth_headers,
            json={"title": "Renamed during title generation"},
        )
        release_title.set()
        response = response_task.result(timeout=10)

    assert renamed.status_code == 200
    assert response.status_code == 200
    assert _event_data(response, "text_delta")[0]["content"] == "A product page."
    assert _event_data(response, "done") == [{}]
    detail = api_client.get(path, headers=auth_headers).json()
    assert detail["title"] == "Renamed during title generation"


def test_browser_chat_title_timeout_keeps_answer_and_prompt_snippet(
    api_client: TestClient,
    auth_headers: dict[str, str],
    committed_thread: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def evaluate(*, request: Any) -> EvaluationResult:
        assert request.message == "What is shown on this page?"
        assert request.context.notes
        return EvaluationResult(
            decision="answer",
            answer="A product page.",
            evidence_ids=[request.context.notes[0].id],
        )

    async def slow_title(
        *, user_prompt: str, assistant_response: str, model: str
    ) -> str:
        assert user_prompt == "What is shown on this page?"
        assert assistant_response == "A product page."
        assert model == "test-model"
        await asyncio.Event().wait()
        return "Unreachable title"

    monkeypatch.setattr(ai_browser_chat.browser_model, "evaluate", evaluate)
    monkeypatch.setattr(ai_threads, "generate_ai_thread_title", slow_title)
    monkeypatch.setattr(ai_browser_chat, "TITLE_GENERATION_TIMEOUT_SECONDS", 0.01)
    path = f"{settings.API_V1_STR}/ai/threads/{committed_thread}"

    response = api_client.post(
        f"{path}/browser-chat",
        headers=auth_headers,
        json=_body(notes=[_known_note()]),
    )

    assert response.status_code == 200
    assert _event_data(response, "text_delta")[0]["content"] == "A product page."
    assert _event_data(response, "done") == [{}]
    detail = api_client.get(path, headers=auth_headers).json()
    assert detail["title"] == "What is shown on this page?"


def test_browser_chat_title_persistence_failure_does_not_fail_answer(
    api_client: TestClient,
    auth_headers: dict[str, str],
    committed_thread: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def evaluate(*, request: Any) -> EvaluationResult:
        return EvaluationResult(
            decision="answer",
            answer="A product page.",
            evidence_ids=[request.context.notes[0].id],
        )

    async def generate_title(
        *, user_prompt: str, assistant_response: str, model: str
    ) -> str:
        assert user_prompt == "What is shown on this page?"
        assert assistant_response == "A product page."
        assert model == "test-model"
        return "Generated browser title"

    def fail_title_persistence(**_: Any) -> None:
        raise RuntimeError("scripted title persistence failure")

    monkeypatch.setattr(ai_browser_chat.browser_model, "evaluate", evaluate)
    monkeypatch.setattr(ai_threads, "generate_ai_thread_title", generate_title)
    monkeypatch.setattr(
        ai_browser_chat.crud, "apply_ai_thread_title", fail_title_persistence
    )
    path = f"{settings.API_V1_STR}/ai/threads/{committed_thread}"
    response = api_client.post(
        f"{path}/browser-chat",
        headers=auth_headers,
        json=_body(notes=[_known_note()]),
    )

    assert response.status_code == 200
    assert _event_data(response, "text_delta")[0]["content"] == "A product page."
    assert _event_data(response, "done") == [{}]
    detail = api_client.get(path, headers=auth_headers).json()
    assert detail["title"] == "What is shown on this page?"


def test_browser_chat_title_model_failure_does_not_fail_answer(
    api_client: TestClient,
    auth_headers: dict[str, str],
    committed_thread: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def evaluate(*, request: Any) -> EvaluationResult:
        return EvaluationResult(
            decision="answer",
            answer="A product page.",
            evidence_ids=[request.context.notes[0].id],
        )

    async def fail_title(**_: Any) -> str:
        raise RuntimeError("scripted title model failure")

    monkeypatch.setattr(ai_browser_chat.browser_model, "evaluate", evaluate)
    monkeypatch.setattr(ai_threads, "generate_ai_thread_title", fail_title)
    path = f"{settings.API_V1_STR}/ai/threads/{committed_thread}"
    response = api_client.post(
        f"{path}/browser-chat",
        headers=auth_headers,
        json=_body(notes=[_known_note()]),
    )

    assert response.status_code == 200
    assert _event_data(response, "text_delta")[0]["content"] == "A product page."
    assert _event_data(response, "done") == [{}]
    detail = api_client.get(path, headers=auth_headers).json()
    assert detail["title"] == "What is shown on this page?"
