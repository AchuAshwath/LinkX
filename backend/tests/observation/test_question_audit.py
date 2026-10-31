"""Regression checks for request progress and failure settlement."""

import asyncio
import base64
import io
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import pytest
from PIL import Image

from app.observation.model import ObservationModelError
from app.observation.question import QuestionInput, QuestionResult, QuestionRunner
from app.observation.schemas import (
    BrowserContext,
    BrowserFrame,
    BrowserMemory,
    BrowserNote,
    EvaluationInput,
    EvaluationResult,
    ReadRequest,
)
from app.services.ai_observation_budget import ObservationInputBudgetError


def _frame(sequence: int) -> BrowserFrame:
    image = io.BytesIO()
    Image.new("RGB", (1, 1)).save(image, format="JPEG")
    return BrowserFrame(
        id=f"frame-{sequence}",
        sequence=sequence,
        captured_at=datetime.now(timezone.utc),
        width=1,
        height=1,
        image_data_url=(
            "data:image/jpeg;base64," + base64.b64encode(image.getvalue()).decode()
        ),
    )


class ScriptedModel:
    def __init__(
        self, decisions: list[EvaluationResult], *, note: BrowserNote | None = None
    ):
        self.decisions = iter(decisions)
        self.note = note
        self.evaluations: list[EvaluationInput] = []
        self.read_ids: list[str] = []
        self.read_failure: BaseException | None = None

    async def evaluate(self, *, request: EvaluationInput) -> EvaluationResult:
        self.evaluations.append(request)
        return next(self.decisions)

    async def read(self, *, request: ReadRequest) -> BrowserNote:
        self.read_ids.append(request.frame.id)
        if self.read_failure is not None:
            raise self.read_failure
        assert self.note is not None
        return self.note


def _context(
    *, pending: list[BrowserFrame], notes: list[BrowserNote] | None = None
) -> BrowserContext:
    return BrowserContext(
        session_id=uuid4(),
        generation=1,
        cutoff=max((frame.sequence for frame in pending), default=5),
        notes=notes or [],
        pending_frames=pending,
    )


def _events_of_type(events, event_type):
    return [data for event, data in events if event == event_type]


def _events_in_state(events, state):
    return [data for data in events if data["state"] == state]


def _values(events, key):
    return [data[key] for data in events]


@pytest.mark.anyio
async def test_insufficient_rechecks_after_pending_frame_is_read() -> None:
    model = ScriptedModel(
        [
            EvaluationResult(decision="insufficient"),
            EvaluationResult(decision="insufficient"),
        ],
        note=BrowserNote(
            id="frame-1", sequence=1, text="Visible item", model="vision-model"
        ),
    )
    result = QuestionResult(unused_ids=["frame-1"])
    context = _context(pending=[_frame(1)])

    async def emit(_event: str, _data: dict[str, Any]) -> None:
        pass

    await QuestionRunner(model=model).run(
        request=QuestionInput(
            message="Can you identify the unseen item?",
            model="vision-model",
            context=context,
            history=[],
            progress=result,
        ),
        emit=emit,
        cancelled=lambda: False,
    )

    assert model.read_ids == ["frame-1"]
    assert len(model.evaluations) == 2
    assert result.completed_ids == ["frame-1"]
    assert result.unused_ids == []
    assert result.failed_ids == []


@pytest.mark.anyio
async def test_cancelled_read_keeps_active_frame_failed_and_tail_unused() -> None:
    model = ScriptedModel(
        [
            EvaluationResult(decision="wait"),
            EvaluationResult(decision="insufficient"),
        ]
    )
    model.read_failure = asyncio.CancelledError()
    result = QuestionResult(unused_ids=["frame-1", "frame-2"])

    async def emit(_event: str, _data: dict[str, Any]) -> None:
        pass

    with pytest.raises(asyncio.CancelledError):
        await QuestionRunner(model=model).run(
            request=QuestionInput(
                message="What does the page say?",
                model="vision-model",
                context=_context(pending=[_frame(1), _frame(2)]),
                history=[],
                progress=result,
            ),
            emit=emit,
            cancelled=lambda: False,
        )

    assert result.failed_ids == ["frame-1"]
    assert result.unused_ids == ["frame-2"]
    assert result.completed_ids == []


@pytest.mark.anyio
async def test_memory_overflow_marks_read_failed_without_emitting_or_appending() -> (
    None
):
    existing_notes = [
        BrowserNote(
            id=f"note-{index}",
            sequence=index,
            text="x" * 7000,
            model="vision-model",
        )
        for index in range(1, 5)
    ]
    BrowserMemory(summary="", notes=existing_notes)
    oversized_note = BrowserNote(
        id="frame-5",
        sequence=5,
        text="y" * 6000,
        model="vision-model",
    )
    model = ScriptedModel(
        [
            EvaluationResult(decision="wait"),
            EvaluationResult(decision="insufficient"),
        ],
        note=oversized_note,
    )
    result = QuestionResult(unused_ids=["frame-5"])
    emitted: list[tuple[str, dict[str, Any]]] = []

    async def emit(event: str, data: dict[str, Any]) -> None:
        emitted.append((event, data))

    await QuestionRunner(model=model).run(
        request=QuestionInput(
            message="What is shown?",
            model="vision-model",
            context=_context(pending=[_frame(5)], notes=existing_notes),
            history=[],
            progress=result,
        ),
        emit=emit,
        cancelled=lambda: False,
    )

    assert model.read_ids == ["frame-5"]
    assert len(model.evaluations[1].context.notes) == 4
    assert model.evaluations[1].context.gap_count == 1
    assert result.completed_ids == []
    assert result.failed_ids == ["frame-5"]
    assert result.unused_ids == []
    assert _events_of_type(emitted, "browser_note") == []
    activity = _events_of_type(emitted, "browser_activity")
    assert _values(activity, "state") == [
        "checking",
        "reading",
        "reading",
        "incomplete",
        "checking",
    ]
    read_events = _events_in_state(activity, "reading")
    assert _values(read_events, "tool_state") == ["running", "failed"]
    assert _values(read_events, "tool_id") == ["frame-5", "frame-5"]
    assert _values(read_events, "view_index") == [1, 1]
    assert _values(read_events, "view_count") == [1, 1]
    assert read_events[1]["failure_code"] == "memory_rejected"
    assert read_events[1]["failure_message"] == (
        "The shared view exceeds the browser memory limit."
    )
    incomplete = _events_in_state(activity, "incomplete")
    assert incomplete == [
        {"state": "incomplete", "message": "A shared view could not be read."}
    ]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("error", "expected_code", "expected_message"),
    [
        (
            TimeoutError("private token abc"),
            "reader_timeout",
            "Reading the shared view timed out.",
        ),
        (
            ObservationInputBudgetError(
                "private model detail", reason="input_too_large"
            ),
            "input_budget",
            "The reading input exceeds the model's allowance.",
        ),
        (
            ObservationInputBudgetError("private model detail"),
            "budget_unavailable",
            "The selected model's input budget could not be verified.",
        ),
        (
            ObservationModelError("Observation model response was truncated"),
            "output_truncated",
            "The model response was truncated.",
        ),
        (
            ObservationModelError("Observation model returned invalid note data"),
            "invalid_output",
            "The model returned invalid reading data.",
        ),
        (
            ObservationModelError("Observation model response is invalid"),
            "invalid_output",
            "The model returned invalid reading data.",
        ),
        (
            ObservationModelError("Observation model provider is unavailable"),
            "provider_error",
            "The reading provider is unavailable.",
        ),
        (
            ObservationModelError("private page text and bearer token"),
            "read_failed",
            "The shared view could not be read.",
        ),
        (
            RuntimeError("private page text and bearer token"),
            "read_failed",
            "The shared view could not be read.",
        ),
    ],
)
async def test_failed_read_emits_only_safe_categorical_diagnostics(
    error: Exception,
    expected_code: str,
    expected_message: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    model = ScriptedModel(
        [
            EvaluationResult(decision="wait"),
            EvaluationResult(decision="insufficient"),
        ]
    )
    model.read_failure = error
    emitted: list[tuple[str, dict[str, Any]]] = []

    async def emit(event: str, data: dict[str, Any]) -> None:
        emitted.append((event, data))

    with caplog.at_level("WARNING", logger="app.observation.question"):
        await QuestionRunner(model=model).run(
            request=QuestionInput(
                message="What is shown?",
                model="vision-model",
                context=_context(pending=[_frame(1)]),
                history=[],
                progress=QuestionResult(unused_ids=["frame-1"]),
            ),
            emit=emit,
            cancelled=lambda: False,
        )

    failure = _events_in_state(_events_of_type(emitted, "browser_activity"), "reading")[
        1
    ]
    assert failure["failure_code"] == expected_code
    assert failure["failure_message"] == expected_message
    assert "private" not in repr(failure)
    assert "token" not in repr(failure)
    assert "private" not in caplog.text
    assert "bearer" not in caplog.text
    assert "failure_code=" + expected_code in caplog.text


@pytest.mark.anyio
async def test_historical_gap_is_not_replayed_and_does_not_modify_answer() -> None:
    note = BrowserNote(
        id="known", sequence=1, text="Visible item", model="vision-model"
    )
    model = ScriptedModel(
        [
            EvaluationResult(
                decision="answer", answer="Exact model answer", evidence_ids=["known"]
            )
        ],
        note=note,
    )
    context = _context(pending=[], notes=[note])
    context.gap_count = 1
    emitted: list[tuple[str, dict[str, Any]]] = []

    async def emit(event: str, data: dict[str, Any]) -> None:
        emitted.append((event, data))

    result = await QuestionRunner(model=model).run(
        request=QuestionInput(
            message="What is visible?",
            model="vision-model",
            context=context,
            history=[],
        ),
        emit=emit,
        cancelled=lambda: False,
    )

    assert result.answer == "Exact model answer"
    assert len(_events_of_type(emitted, "browser_activity")) == 1
    assert emitted[0] == (
        "browser_activity",
        {"state": "checking", "message": "Preparing an answer."},
    )


@pytest.mark.anyio
async def test_summary_answer_can_coexist_with_unrelated_notes() -> None:
    model = ScriptedModel(
        [
            EvaluationResult(
                decision="answer",
                answer="The check-in form is submitted with the blue button.",
                evidence_ids=[],
            )
        ]
    )
    context = _context(
        pending=[],
        notes=[
            BrowserNote(
                id="unrelated",
                sequence=1,
                text="The page footer lists support hours.",
                model="vision-model",
            )
        ],
    )
    context.summary = "The check-in form is submitted with the blue button."

    async def emit(_event: str, _data: dict[str, Any]) -> None:
        pass

    result = await QuestionRunner(model=model).run(
        request=QuestionInput(
            message="How do I submit check-in?",
            model="vision-model",
            context=context,
            history=[],
        ),
        emit=emit,
        cancelled=lambda: False,
    )

    assert result.answer == "The check-in form is submitted with the blue button."
