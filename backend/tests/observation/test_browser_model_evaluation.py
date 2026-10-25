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
from app.observation.schemas import BrowserFrame, BrowserNote, EvaluationInput


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


def _current_view_request() -> tuple[EvaluationInput, BrowserFrame, BrowserFrame]:
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
    return request, pending, current


class _PendingViewProvider:
    def __init__(self) -> None:
        self.payload: dict[str, Any] = {}

    async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
        self.payload = payload
        return json.dumps(
            {
                "decision": "wait",
                "answer": "",
                "evidence_ids": [],
                "requires_complete": False,
                "answer_basis": "browser",
            }
        )


def _assert_browser_evaluation_rules(system_prompt: str) -> None:
    assert "all, every" in system_prompt
    assert "answer_basis" in system_prompt
    assert "conversation or general answers must not include IDs" in system_prompt
    assert "Browser or mixed answers need at least one supplied evidence" in (
        system_prompt
    )
    assert "comparisons" in system_prompt
    assert "gaps" in system_prompt
    assert "pending frame" in system_prompt
    assert "choose wait whenever any pending frame could resolve missing evidence" in (
        system_prompt
    )
    assert "Never answer speculatively" in system_prompt


def _assert_current_view_image_only(
    *,
    content: list[dict[str, Any]],
    counted_messages: list[dict[str, Any]],
    pending: BrowserFrame,
    current: BrowserFrame,
) -> None:
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
    assert counted_messages[1]["content"][2]["image_url"]["url"] == (
        current.image_data_url
    )
    assert pending.image_data_url not in json.dumps(counted_messages)


@pytest.mark.anyio
async def test_evaluate_sends_only_current_view_as_image() -> None:
    request, pending, current = _current_view_request()
    provider = _PendingViewProvider()

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
        await BrowserModel(provider=provider).evaluate(request=request)

    messages = provider.payload["messages"]
    _assert_browser_evaluation_rules(messages[0]["content"])
    _assert_current_view_image_only(
        content=messages[1]["content"],
        counted_messages=counter.call_args.kwargs["messages"],
        pending=pending,
        current=current,
    )
