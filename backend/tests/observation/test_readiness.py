import asyncio
from uuid import uuid4

import pytest
from pydantic import ValidationError
from test_question import frame

from app.observation.model import BrowserModel, ObservationModelError
from app.observation.question import QuestionInput, QuestionResult, QuestionRunner
from app.observation.schemas import (
    BrowserContext,
    BrowserNote,
    EvaluationInput,
    ReadinessResult,
)


async def _discard_event(event, data):
    del event, data


def _read_next():
    return ReadinessResult(
        decision="read_next",
        evidence_ids=[],
        requires_complete=False,
        answer_basis="browser",
    )


def _ready(evidence_ids, *, complete=False):
    return ReadinessResult(
        decision="ready",
        evidence_ids=evidence_ids,
        requires_complete=complete,
        answer_basis="browser",
    )


class _SecondFactModel:
    def __init__(self):
        self.readiness = iter([_read_next(), _read_next(), _ready(["f2"])])
        self.read_ids = []

    async def prepare(self, *, request):
        return next(self.readiness)

    async def read(self, *, request):
        self.read_ids.append(request.frame.id)
        text = (
            "unrelated introduction"
            if request.frame.id == "f1"
            else "Target fact: due Friday"
        )
        return BrowserNote(
            id=request.frame.id,
            sequence=request.frame.sequence,
            model=request.model,
            text=text,
        )


def test_readiness_result_rejects_answer_text_and_missing_fields():
    with pytest.raises(ValidationError):
        ReadinessResult.model_validate(
            {
                "decision": "ready",
                "answer": "The page says Friday.",
                "evidence_ids": ["note-1"],
                "requires_complete": False,
                "answer_basis": "browser",
            }
        )

    with pytest.raises(ValidationError):
        ReadinessResult.model_validate({"decision": "ready"})


@pytest.mark.anyio
async def test_browser_model_prepares_strict_readiness_without_answer_field():
    request = EvaluationInput(
        message="What is the page status?",
        model="selected-model",
        context={"session_id": uuid4(), "generation": 1, "cutoff": 0},
        history=[{"role": "user", "content": "Earlier relevant detail"}],
    )
    seen = {}

    class Provider:
        async def __call__(self, *, config, payload):
            seen["payload"] = payload
            return '{"decision":"ready","evidence_ids":[],"requires_complete":false,"answer_basis":"general"}'

    model = BrowserModel(provider=Provider(), budgeter=lambda **_: None)
    assert model.preflight_readiness(request=request) is None
    result = await model.prepare(request=request)

    assert result.decision == "ready"
    schema = seen["payload"]["response_format"]["json_schema"]
    assert schema["name"] == "browser_readiness"
    assert "answer" not in schema["schema"]["properties"]
    assert schema["schema"]["required"] == [
        "decision",
        "evidence_ids",
        "requires_complete",
        "answer_basis",
    ]
    assert seen["payload"]["model"] == "selected-model"
    assert "Earlier relevant detail" in seen["payload"]["messages"][1]["content"]
    assert (
        "do not write user-facing prose"
        in seen["payload"]["messages"][0]["content"].lower()
    )


@pytest.mark.anyio
async def test_browser_model_rejects_missing_readiness_fields():
    request = EvaluationInput(
        message="What is the page status?",
        model="selected-model",
        context={"session_id": uuid4(), "generation": 1, "cutoff": 0},
    )

    class Provider:
        async def __call__(self, *, config, payload):
            return '{"decision":"ready"}'

    with pytest.raises(ObservationModelError, match="invalid readiness data"):
        await BrowserModel(provider=Provider(), budgeter=lambda **_: None).prepare(
            request=request
        )


@pytest.mark.anyio
async def test_prepare_reads_two_frozen_views_until_second_fact_is_available():
    model = _SecondFactModel()
    context = BrowserContext(
        session_id=uuid4(),
        generation=1,
        cutoff=2,
        pending_frames=[frame(1), frame(2)],
    )
    events = []

    async def emit(event, data):
        events.append((event, data))

    prepared = await QuestionRunner(model=model).prepare(
        request=QuestionInput(
            message="When is the target due?",
            model="selected",
            context=context,
            history=[],
        ),
        emit=emit,
        cancelled=lambda: False,
    )

    assert prepared.ready is True
    assert prepared.insufficient is False
    assert prepared.answer_basis == "browser"
    assert [note.id for note in prepared.context.notes] == ["f1", "f2"]
    assert [note.id for note in context.notes] == []
    assert model.read_ids == ["f1", "f2"]
    assert prepared.result.completed_ids == ["f1", "f2"]
    assert prepared.result.unused_ids == []
    assert [event for event, _ in events if event == "browser_note"] == [
        "browser_note",
        "browser_note",
    ]
    activity = [data for event, data in events if event == "browser_activity"]
    assert [data["state"] for data in activity if "tool_state" not in data] == [
        "checking",
        "checking",
        "checking",
    ]
    assert [data["tool_state"] for data in activity if "tool_state" in data] == [
        "running",
        "completed",
        "running",
        "completed",
    ]


@pytest.mark.anyio
async def test_prepare_accepts_early_supported_note_and_preserves_unused_receipts():
    class Model:
        read_ids = []

        async def prepare(self, *, request):
            return ReadinessResult(
                decision="ready",
                evidence_ids=["existing"],
                requires_complete=False,
                answer_basis="browser",
            )

        async def read(self, *, request):
            self.read_ids.append(request.frame.id)
            raise AssertionError(
                "a supported early answer must not drain pending views"
            )

    context = BrowserContext(
        session_id=uuid4(),
        generation=1,
        cutoff=3,
        notes=[
            BrowserNote(id="existing", sequence=1, model="selected", text="Known fact")
        ],
        pending_frames=[frame(2), frame(3)],
    )
    progress = QuestionRunner(model=Model())
    prior_result = QuestionResult(
        completed_ids=["prior-frame"], unused_ids=["f2", "f3"]
    )
    emitted = []

    async def emit(event, data):
        emitted.append((event, data))

    prepared = await progress.prepare(
        request=QuestionInput(
            message="What is the known fact?",
            model="selected",
            context=context,
            history=[],
            progress=prior_result,
        ),
        emit=emit,
        cancelled=lambda: False,
    )

    assert prepared.ready is True
    assert prepared.insufficient is False
    assert prepared.result is prior_result
    assert prepared.result.unused_ids == ["f2", "f3"]
    assert [event for event, _ in emitted if event == "browser_activity"] == [
        "browser_activity"
    ]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("decision", "basis", "expected_insufficient"),
    [("read_next", "general", False), ("insufficient", "browser", True)],
)
async def test_prepare_nonreadable_or_insufficient_question_keeps_pending_views(
    decision, basis, expected_insufficient
):
    class Model:
        calls = 0
        read_ids = []

        async def prepare(self, *, request):
            self.calls += 1
            return ReadinessResult(
                decision=decision,
                evidence_ids=[],
                requires_complete=False,
                answer_basis=basis,
            )

        async def read(self, *, request):
            self.read_ids.append(request.frame.id)
            raise AssertionError("these decisions must not read pending views")

    model = Model()
    context = BrowserContext(
        session_id=uuid4(),
        generation=1,
        cutoff=2,
        pending_frames=[frame(1), frame(2)],
    )
    prepared = await QuestionRunner(model=model).prepare(
        request=QuestionInput(
            message=(
                "How do I share a tab?"
                if basis == "general"
                else "What is the page's author?"
            ),
            model="selected",
            context=context,
            history=[],
        ),
        emit=_discard_event,
        cancelled=lambda: False,
    )

    assert prepared.ready is not expected_insufficient
    assert prepared.insufficient is expected_insufficient
    assert prepared.answer_basis == basis
    assert prepared.result.unused_ids == ["f1", "f2"]
    assert model.calls == 1
    assert model.read_ids == []


@pytest.mark.anyio
async def test_prepare_broad_question_reads_all_pending_frames_before_ready():
    class Model:
        def __init__(self):
            self.responses = iter(
                [
                    ReadinessResult(
                        decision="ready",
                        evidence_ids=[],
                        requires_complete=False,
                        answer_basis="browser",
                    ),
                    ReadinessResult(
                        decision="ready",
                        evidence_ids=["f1"],
                        requires_complete=False,
                        answer_basis="browser",
                    ),
                    ReadinessResult(
                        decision="ready",
                        evidence_ids=["f1", "f2"],
                        requires_complete=True,
                        answer_basis="browser",
                    ),
                ]
            )
            self.read_ids = []

        async def prepare(self, *, request):
            return next(self.responses)

        async def read(self, *, request):
            self.read_ids.append(request.frame.id)
            return BrowserNote(
                id=request.frame.id,
                sequence=request.frame.sequence,
                model=request.model,
                text=f"Fact from {request.frame.id}",
            )

    model = Model()
    context = BrowserContext(
        session_id=uuid4(),
        generation=1,
        cutoff=2,
        pending_frames=[frame(1), frame(2)],
    )
    prepared = await QuestionRunner(model=model).prepare(
        request=QuestionInput(
            message="Summarize every item",
            model="selected",
            context=context,
            history=[],
        ),
        emit=_discard_event,
        cancelled=lambda: False,
    )

    assert prepared.ready is True
    assert prepared.insufficient is False
    assert model.read_ids == ["f1", "f2"]
    assert prepared.result.completed_ids == ["f1", "f2"]
    assert prepared.result.failed_ids == []
    assert prepared.result.unused_ids == []


@pytest.mark.anyio
async def test_prepare_returns_insufficient_when_broad_coverage_has_a_failed_frame():
    class Model:
        def __init__(self):
            self.responses = iter(
                [
                    _read_next(),
                    _ready(["prior-summary"], complete=True),
                    _ready(["prior-summary"], complete=True),
                ]
            )

        async def prepare(self, *, request):
            return next(self.responses)

        async def read(self, *, request):
            if request.frame.id == "f1":
                raise RuntimeError("synthetic read failure")
            return BrowserNote(
                id=request.frame.id,
                sequence=request.frame.sequence,
                model=request.model,
                text="A later fact",
            )

    context = BrowserContext(
        session_id=uuid4(),
        generation=1,
        cutoff=2,
        summary="Prior list content",
        pending_frames=[frame(1), frame(2)],
    )
    events = []

    async def emit(event, data):
        events.append((event, data))

    prepared = await QuestionRunner(model=Model()).prepare(
        request=QuestionInput(
            message="Summarize every item",
            model="selected",
            context=context,
            history=[],
        ),
        emit=emit,
        cancelled=lambda: False,
    )

    assert prepared.ready is False
    assert prepared.insufficient is True
    assert prepared.context.gap_count == 1
    assert prepared.result.failed_ids == ["f1"]
    assert prepared.result.completed_ids == ["f2"]
    assert prepared.result.unused_ids == []
    assert [
        data["tool_state"]
        for event, data in events
        if event == "browser_activity" and "tool_state" in data
    ] == [
        "running",
        "failed",
        "running",
        "completed",
    ]


@pytest.mark.anyio
async def test_prepare_honors_stop_during_sequential_frame_read():
    stopped = False

    class Model:
        calls = 0

        async def prepare(self, *, request):
            self.calls += 1
            return _read_next()

        async def read(self, *, request):
            nonlocal stopped
            stopped = True
            return BrowserNote(
                id=request.frame.id,
                sequence=request.frame.sequence,
                model=request.model,
                text="A fact",
            )

    model = Model()
    context = BrowserContext(
        session_id=uuid4(),
        generation=1,
        cutoff=2,
        pending_frames=[frame(1), frame(2)],
    )

    with pytest.raises(asyncio.CancelledError):
        await QuestionRunner(model=model).prepare(
            request=QuestionInput(
                message="Find a fact", model="selected", context=context, history=[]
            ),
            emit=_discard_event,
            cancelled=lambda: stopped,
        )

    assert model.calls == 1
    assert context.notes == []


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("summary", "evidence_ids", "expected_ready"),
    [("", ["foreign"], False), ("The page says Friday.", [], True)],
)
async def test_prepare_requires_known_evidence_or_summary_for_browser_ready(
    summary, evidence_ids, expected_ready
):
    class Model:
        async def prepare(self, *, request):
            return _ready(evidence_ids)

        async def read(self, *, request):
            raise AssertionError("there are no frames available")

    context = BrowserContext(
        session_id=uuid4(), generation=1, cutoff=0, summary=summary
    )
    prepared = await QuestionRunner(model=Model()).prepare(
        request=QuestionInput(
            message="What does the page say?",
            model="selected",
            context=context,
            history=[],
        ),
        emit=_discard_event,
        cancelled=lambda: False,
    )

    assert prepared.ready is expected_ready
    assert prepared.insufficient is not expected_ready
