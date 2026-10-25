import base64
import io
import json
from datetime import datetime, timezone
from typing import Any
from unittest.mock import patch
from uuid import uuid4

import pytest
from PIL import Image

from app.observation.model import BrowserModel
from app.observation.schemas import BrowserFrame, EvaluationInput, ReadRequest


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
