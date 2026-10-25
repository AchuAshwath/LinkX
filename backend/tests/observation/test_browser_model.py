import asyncio
import base64
import io
import json
from datetime import datetime, timezone
from typing import Any
from unittest.mock import patch
from uuid import uuid4

import httpx
import pytest
from PIL import Image

from app.observation.model import (
    BrowserModel,
    DirectOpenAIProvider,
    ObservationModelError,
    ProviderConfig,
)
from app.observation.schemas import (
    BrowserFrame,
    BrowserNote,
    CompactRequest,
    EvaluationInput,
    ReadRequest,
)


def test_reading_preflight_uses_selected_model_window_instead_of_legacy_demo_cap() -> (
    None
):
    request = EvaluationInput(
        message="What does the shared page describe?",
        model="large-vision-model",
        context={"session_id": uuid4(), "generation": 1, "cutoff": 0},
    )
    with (
        patch(
            "litellm.get_model_info",
            return_value={
                "max_input_tokens": 64_000,
                "max_output_tokens": 8_000,
                "supports_vision": True,
            },
        ),
        patch("litellm.token_counter", return_value=13_000),
    ):
        BrowserModel().preflight(request=request)


@pytest.mark.anyio
async def test_question_preserves_browser_memory_and_recent_turns_when_old_history_cannot_fit() -> (
    None
):
    request = _history_fit_request()
    provider = _HistoryFitProvider()

    with (
        patch(
            "litellm.get_model_info",
            return_value={
                "max_input_tokens": 9_000,
                "max_output_tokens": 3_000,
                "supports_vision": True,
            },
        ),
        patch(
            "litellm.token_counter",
            side_effect=lambda **kwargs: len(json.dumps(kwargs["messages"])) // 4,
        ),
    ):
        model = BrowserModel(provider=provider)
        report = model.preflight(request=request)
        assert provider.calls == []
        await model.evaluate(request=request)
    sent = json.loads(provider.calls[0]["messages"][1]["content"])
    assert sent["history"] == [
        {"role": "user", "content": "Recent question."},
        {"role": "assistant", "content": "Recent answer."},
    ]
    assert sent["message"] == request.message
    assert sent["browser_context"]["notes"][0]["text"] == "Badge P2R7."
    assert "data:image" not in json.dumps(provider.calls)
    assert report["omitted_history_messages"] == 2
    assert report["input_limit"] == 7_000


def _history_fit_request() -> EvaluationInput:
    old_user = {
        "id": "old",
        "role": "user",
        "parts": [
            {"type": "text", "text": "OLD-TURN " * 4000},
            {"type": "image_url", "url": "data:image/jpeg;base64," + "A" * 60_000},
        ],
    }
    recent_turn = [
        {
            "id": "old-answer",
            "role": "assistant",
            "parts": [{"type": "text", "text": "Old answer."}],
        },
        {
            "id": "recent",
            "role": "user",
            "parts": [{"type": "text", "text": "Recent question."}],
        },
        {
            "id": "recent-answer",
            "role": "assistant",
            "parts": [{"type": "text", "text": "Recent answer."}],
        },
    ]
    return EvaluationInput(
        message="What is the shared page's badge?",
        model="vision-model",
        context={
            "session_id": uuid4(),
            "generation": 1,
            "cutoff": 1,
            "notes": [
                {
                    "id": "note-1",
                    "sequence": 1,
                    "model": "vision-model",
                    "text": "Badge P2R7.",
                }
            ],
        },
        history=[old_user, *recent_turn],
    )


class _HistoryFitProvider:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
        self.calls.append(payload)
        return json.dumps(
            {
                "decision": "answer",
                "answer": "P2R7",
                "evidence_ids": ["note-1"],
                "requires_complete": False,
                "answer_basis": "browser",
            }
        )


def _frame(*, frame_id: str = "opaque-frame-7", sequence: int = 7) -> BrowserFrame:
    image = io.BytesIO()
    color = (sequence % 255, (sequence * 3) % 255, (sequence * 7) % 255)
    Image.new("RGB", (1, 1), color).save(image, format="JPEG")
    encoded = base64.b64encode(image.getvalue()).decode("ascii")
    return BrowserFrame(
        id=frame_id,
        sequence=sequence,
        captured_at=datetime.now(timezone.utc),
        width=1,
        height=1,
        image_data_url=f"data:image/jpeg;base64,{encoded}",
    )


@pytest.mark.anyio
async def test_read_budgets_the_full_selected_model_request() -> None:
    request = ReadRequest(
        operation_id=uuid4(), model="openai/vision-model", frame=_frame()
    )

    class FakeProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            return json.dumps({"text": "A page is visible.", "uncertainty": ""})

    with (
        patch(
            "litellm.get_model_info",
            return_value={
                "max_input_tokens": 10_000,
                "max_output_tokens": 2_000,
                "supports_vision": True,
            },
        ),
        patch("litellm.token_counter", return_value=531) as counter,
    ):
        note = await BrowserModel(provider=FakeProvider()).read(request=request)

    assert note.text == "A page is visible."
    counter.assert_called_once()
    kwargs = counter.call_args.kwargs
    assert kwargs["model"] == "vision-model"
    assert kwargs["messages"][1]["content"][1]["image_url"]["url"] == (
        request.frame.image_data_url
    )


@pytest.mark.anyio
async def test_evaluate_returns_typed_decision_with_supplied_evidence_ids() -> None:
    note = BrowserNote(
        id="evidence-frame",
        sequence=1,
        model="vision",
        text="A red button says Continue.",
    )
    request = EvaluationInput(
        message="What does the button say?",
        model="selected-model",
        context={
            "session_id": uuid4(),
            "generation": 1,
            "cutoff": 1,
            "summary": "",
            "notes": [note],
        },
        history=[{"role": "user", "content": "Earlier question"}],
    )
    seen: dict[str, Any] = {}

    class FakeProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            seen["payload"] = payload
            return json.dumps(
                {
                    "decision": "answer",
                    "answer": "It says Continue.",
                    "evidence_ids": ["evidence-frame"],
                    "requires_complete": True,
                    "answer_basis": "browser",
                }
            )

    result = await BrowserModel(
        provider=FakeProvider(), budgeter=lambda **_: None
    ).evaluate(request=request)

    assert result.decision == "answer"
    assert result.answer == "It says Continue."
    assert result.evidence_ids == ["evidence-frame"]
    assert result.requires_complete is True
    assert result.answer_basis == "browser"
    prompt = seen["payload"]["messages"]
    assert prompt[1]["content"].index("Earlier question") < prompt[1]["content"].index(
        "evidence-frame"
    )


@pytest.mark.anyio
async def test_evaluation_provider_prompt_explains_browser_tab_sharing() -> None:
    request = EvaluationInput(
        message="I will share you a browser tab. Tell me what people posted.",
        model="selected-model",
        context={"session_id": uuid4(), "generation": 1, "cutoff": 0},
    )
    seen: dict[str, Any] = {}

    class FakeProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            seen["payload"] = payload
            return json.dumps(
                {
                    "decision": "wait",
                    "answer": "",
                    "evidence_ids": [],
                    "requires_complete": False,
                    "answer_basis": "general",
                }
            )

    await BrowserModel(provider=FakeProvider(), budgeter=lambda **_: None).evaluate(
        request=request
    )

    prompt = seen["payload"]["messages"][0]["content"].lower()
    assert "browser tab" in prompt
    assert "menu" in prompt
    assert "temporary chat" in prompt
    assert "claim current sharing only from supplied session evidence" in prompt
    assert "describe content only from supplied notes or images" in prompt
    assert (
        "pending-frame metadata is processing state, not readable page content"
        in prompt
    )
    assert "or demand pasted content or screenshots as the only way" in prompt
    assert (
        "reading or summarizing shared posts is not a request to create, edit, save or publish a draft"
        in prompt
    )
    assert "no permission to control the tab" in prompt
    assert "processing is pending only when supplied state confirms it" in prompt
    assert "answer product, setup, and capability questions immediately" in prompt
    assert "a promise to share later is not pending work" in prompt
    assert "choose wait only when supplied pending frames can answer" in prompt
    assert "choose insufficient" in prompt
    assert "do not answer a page-content question with setup guidance alone" in prompt


@pytest.mark.anyio
async def test_evaluate_accepts_explicit_general_knowledge_basis() -> None:
    request = EvaluationInput(
        message="What is a tuple?",
        model="selected-model",
        context={"session_id": uuid4(), "generation": 1, "cutoff": 0},
    )

    class FakeProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            return json.dumps(
                {
                    "decision": "answer",
                    "answer": "An immutable sequence.",
                    "evidence_ids": [],
                    "requires_complete": False,
                    "answer_basis": "general",
                }
            )

    result = await BrowserModel(
        provider=FakeProvider(), budgeter=lambda **_: None
    ).evaluate(request=request)

    assert result.answer_basis == "general"
    assert result.answer == "An immutable sequence."


@pytest.mark.anyio
async def test_evaluate_sends_only_current_view_as_image() -> None:
    pending = _frame(frame_id="pending-frame", sequence=2)
    current = _frame(frame_id="current-frame", sequence=3)
    request = EvaluationInput(
        message="What is on screen?",
        model="selected-model",
        context={
            "session_id": uuid4(),
            "generation": 1,
            "cutoff": 3,
            "summary": "The page is a checkout.",
            "notes": [
                {
                    "id": "note-frame",
                    "sequence": 1,
                    "model": "vision",
                    "text": "Cart has one item.",
                }
            ],
            "pending_frames": [pending],
            "current_view": current,
            "gap_count": 1,
        },
    )
    seen: dict[str, Any] = {}

    class FakeProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            seen["payload"] = payload
            return json.dumps(
                {
                    "decision": "wait",
                    "answer": "",
                    "evidence_ids": [],
                    "requires_complete": False,
                    "answer_basis": "browser",
                }
            )

    with (
        patch(
            "litellm.get_model_info",
            return_value={
                "max_input_tokens": 10_000,
                "max_output_tokens": 2_000,
                "supports_vision": True,
            },
        ),
        patch("litellm.token_counter", return_value=400) as counter,
    ):
        await BrowserModel(provider=FakeProvider()).evaluate(request=request)

    content = seen["payload"]["messages"][1]["content"]
    system_prompt = seen["payload"]["messages"][0]["content"]
    assert "all, every" in system_prompt
    assert "answer_basis" in system_prompt
    assert "conversation or general answers must not include IDs" in system_prompt
    assert (
        "Browser or mixed answers need at least one supplied evidence" in system_prompt
    )
    assert "comparisons" in system_prompt
    assert "gaps" in system_prompt
    assert "pending frame" in system_prompt
    assert "choose wait whenever any pending frame could resolve missing evidence" in (
        system_prompt
    )
    assert "Never answer speculatively" in system_prompt
    serialized_text = content[0]["text"]
    assert "The page is a checkout." in serialized_text
    assert "Cart has one item." in serialized_text
    assert "pending-frame" in serialized_text
    assert "current-frame" in serialized_text
    assert pending.image_data_url not in serialized_text
    assert current.image_data_url not in serialized_text
    image_parts = [part for part in content if part.get("type") == "image_url"]
    assert image_parts == [
        {
            "type": "image_url",
            "image_url": {"url": current.image_data_url},
        }
    ]
    counted_messages = counter.call_args.kwargs["messages"]
    assert counted_messages[1]["content"][2]["image_url"]["url"] == (
        current.image_data_url
    )
    assert pending.image_data_url not in json.dumps(counted_messages)


@pytest.mark.anyio
async def test_preflight_budgets_exact_evaluation_without_provider_call() -> None:
    request = EvaluationInput(
        message="What does the button say?",
        model="selected-model",
        context={
            "session_id": uuid4(),
            "generation": 1,
            "cutoff": 2,
            "summary": "A checkout page.",
            "notes": [
                {
                    "id": "note-1",
                    "sequence": 1,
                    "model": "vision",
                    "text": "The button says Pay now.",
                }
            ],
            "pending_frames": [_frame(frame_id="pending-2", sequence=2)],
            "gap_count": 0,
        },
        history=[{"role": "user", "content": "Earlier turn"}],
    )
    budget_calls: list[dict[str, Any]] = []

    def record_budget(**kwargs: Any) -> None:
        budget_calls.append(kwargs)

    class FakeProvider:
        def __init__(self) -> None:
            self.calls = 0

        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            self.calls += 1
            return json.dumps(
                {
                    "decision": "answer",
                    "answer": "Pay now.",
                    "evidence_ids": ["note-1"],
                    "requires_complete": False,
                    "answer_basis": "browser",
                }
            )

    provider = FakeProvider()
    model = BrowserModel(provider=provider, budgeter=record_budget)

    model.preflight(request=request)

    assert provider.calls == 0
    await model.evaluate(request=request)

    assert provider.calls == 1
    assert len(budget_calls) == 2
    assert budget_calls[0] == budget_calls[1]
    assert budget_calls[0]["model"] == "selected-model"
    assert budget_calls[0]["output_reserve"] > 0
    serialized = json.dumps(budget_calls[0]["messages"])
    assert "Earlier turn" in serialized
    assert "Pay now." in serialized
    assert "pending-2" in serialized


@pytest.mark.anyio
async def test_compaction_sends_strict_schema_and_budgets_it() -> None:
    request = CompactRequest(
        operation_id=uuid4(), model="selected-model", summary="A page.", notes=[]
    )
    budgeted_messages: list[list[dict[str, Any]]] = []
    seen: dict[str, Any] = {}

    def budgeter(**kwargs: Any) -> None:
        budgeted_messages.append(kwargs["messages"])

    class FakeProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            seen["payload"] = payload
            return json.dumps({"summary": "A concise page summary."})

    summary = await BrowserModel(provider=FakeProvider(), budgeter=budgeter).compact(
        request=request
    )

    assert summary == "A concise page summary."
    response_format = seen["payload"]["response_format"]
    schema = response_format["json_schema"]
    assert schema["strict"] is True
    assert schema["schema"]["additionalProperties"] is False
    assert schema["schema"]["required"] == ["summary"]
    assert schema["schema"]["properties"]["summary"]["minLength"] == 1
    assert schema["schema"]["properties"]["summary"]["pattern"] == r"\S"
    assert budgeted_messages[0][:-1] == seen["payload"]["messages"]
    assert json.loads(budgeted_messages[0][-1]["content"]) == response_format


@pytest.mark.anyio
@pytest.mark.parametrize("summary", ["", " \t\n"])
async def test_compaction_rejects_blank_summary(*, summary: str) -> None:
    request = CompactRequest(
        operation_id=uuid4(), model="selected-model", summary="A page.", notes=[]
    )

    class FakeProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            return json.dumps({"summary": summary})

    with pytest.raises(ObservationModelError, match="invalid summary data"):
        await BrowserModel(provider=FakeProvider(), budgeter=lambda **_: None).compact(
            request=request
        )


@pytest.mark.anyio
async def test_direct_provider_parses_only_message_content_without_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.config import settings

    monkeypatch.setattr(
        settings, "OPENAI_API_COMPATIBLE_API_KEY", "test-observation-key"
    )
    request = ReadRequest(operation_id=uuid4(), model="vision-model", frame=_frame())
    seen: dict[str, Any] = {}

    def respond(http_request: httpx.Request) -> httpx.Response:
        seen["url"] = str(http_request.url)
        seen["authorization"] = http_request.headers["Authorization"]
        seen["payload"] = json.loads(http_request.content)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {"text": "A visible menu.", "uncertainty": ""}
                            ),
                            "reasoning_content": '{"text":"wrong"}',
                        }
                    }
                ]
            },
        )

    provider = DirectOpenAIProvider(transport=httpx.MockTransport(respond))
    with (
        patch(
            "litellm.get_model_info",
            return_value={
                "max_input_tokens": 10_000,
                "max_output_tokens": 2_000,
                "supports_vision": True,
            },
        ),
        patch("litellm.token_counter", return_value=100),
    ):
        note = await BrowserModel(provider=provider).read(request=request)

    assert note.text == "A visible menu."
    assert seen["url"] == "http://127.0.0.1:8317/v1/chat/completions"
    assert seen["authorization"] == "Bearer test-observation-key"
    assert seen["payload"]["stream"] is False
    response_format = seen["payload"]["response_format"]
    schema = response_format["json_schema"]
    assert schema["strict"] is True
    assert schema["schema"]["additionalProperties"] is False
    assert schema["schema"]["required"] == ["text", "uncertainty"]
    assert schema["schema"]["properties"]["text"]["minLength"] == 1
    assert schema["schema"]["properties"]["text"]["pattern"] == r"\S"
    assert all(
        "default" not in field for field in schema["schema"]["properties"].values()
    )


@pytest.mark.anyio
async def test_provider_http_error_does_not_expose_response_body() -> None:
    private_body = "PROVIDER_PRIVATE_RESPONSE_BODY"

    def respond(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text=private_body)

    provider = DirectOpenAIProvider(transport=httpx.MockTransport(respond))

    with pytest.raises(ObservationModelError) as error:
        await provider(
            config=ProviderConfig(base_url="https://provider.invalid/v1", api_key="k"),
            payload={"model": "m", "messages": []},
        )

    assert private_body not in str(error.value)


@pytest.mark.anyio
async def test_provider_rejects_truncated_json_even_when_content_parses() -> None:
    def respond(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "length",
                        "message": {"content": json.dumps({"text": "partial"})},
                    }
                ]
            },
        )

    provider = DirectOpenAIProvider(transport=httpx.MockTransport(respond))
    with pytest.raises(ObservationModelError, match="truncated"):
        await provider(
            config=ProviderConfig(base_url="https://provider.invalid/v1", api_key="k"),
            payload={"model": "m", "messages": []},
        )


@pytest.mark.anyio
async def test_malformed_model_json_is_rejected_without_echoing_content() -> None:
    private_content = "PRIVATE_MODEL_OUTPUT"

    class MalformedProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            return private_content

    request = ReadRequest(operation_id=uuid4(), model="vision-model", frame=_frame())
    with pytest.raises(ObservationModelError) as error:
        await BrowserModel(
            provider=MalformedProvider(), budgeter=lambda **_: None
        ).read(request=request)

    assert private_content not in str(error.value)


@pytest.mark.anyio
async def test_model_call_has_total_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.observation.model as model_module

    monkeypatch.setattr(model_module, "MODEL_TIMEOUT_SECONDS", 0.01)

    class SlowProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            await asyncio.sleep(1)
            return "{}"

    request = ReadRequest(operation_id=uuid4(), model="vision-model", frame=_frame())
    with pytest.raises(ObservationModelError, match="timed out"):
        await BrowserModel(provider=SlowProvider(), budgeter=lambda **_: None).read(
            request=request
        )
