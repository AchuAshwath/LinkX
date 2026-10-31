import base64
import io
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from PIL import Image

from app.observation.question import QuestionInput, QuestionRunner
from app.observation.schemas import (
    BrowserContext,
    BrowserFrame,
    BrowserNote,
    EvaluationResult,
)


def frame(sequence):
    data = io.BytesIO()
    Image.new("RGB", (1, 1)).save(data, format="JPEG")
    return BrowserFrame(
        id=f"f{sequence}",
        sequence=sequence,
        captured_at=datetime.now(timezone.utc),
        width=1,
        height=1,
        image_data_url="data:image/jpeg;base64,"
        + base64.b64encode(data.getvalue()).decode(),
    )


class ScriptedModel:
    def __init__(self, decisions, *, note_text="page fact"):
        self.note_text = note_text
        self.decisions = iter(decisions)
        self.calls = []

    async def evaluate(self, *, request):
        self.calls.append(("evaluate", request.context.model_copy(deep=True)))
        return next(self.decisions)

    async def read(self, *, request):
        self.calls.append(("read", request.frame.id))
        return BrowserNote(
            id=request.frame.id,
            sequence=request.frame.sequence,
            text=self.note_text,
            model=request.model,
        )


def activity_events(events):
    return [data for event, data in events if event == "browser_activity"]


def events_in_state(events, state):
    return [data for data in events if data["state"] == state]


def event_values(events, key):
    return [data[key] for data in events]


@pytest.mark.anyio
async def test_budget_diagnostics_refresh_after_each_pending_image_is_read():
    model = ScriptedModel(
        [
            EvaluationResult(decision="wait"),
            EvaluationResult(decision="answer", answer="fact", evidence_ids=["f1"]),
        ]
    )
    context = BrowserContext(
        session_id=uuid4(), generation=1, cutoff=1, pending_frames=[frame(1)]
    )
    events = []

    async def emit(event, data):
        events.append((event, data))

    def inspect_budget(*, request):
        return {"estimated_input_tokens": 100 if request.context.notes else 20}

    await QuestionRunner(model=model, inspect_budget=inspect_budget).run(
        request=QuestionInput(
            message="fact?", model="vision", context=context, history=[]
        ),
        emit=emit,
        cancelled=lambda: False,
    )
    assert [event for event, _ in events if event != "browser_activity"] == [
        "browser_budget",
        "browser_note",
        "browser_budget",
    ]
    assert [
        data["estimated_input_tokens"]
        for event, data in events
        if event == "browser_budget"
    ] == [20, 100]


@pytest.mark.anyio
async def test_wait_rechecks_each_note_and_returns_unused_frames():
    model = ScriptedModel(
        [
            EvaluationResult(decision="wait"),
            EvaluationResult(decision="answer", answer="fact", evidence_ids=["f1"]),
        ]
    )
    context = BrowserContext.model_construct(
        session_id=uuid4(),
        generation=1,
        cutoff=2,
        summary="",
        notes=[],
        pending_frames=[frame(1), frame(2)],
        current_view=None,
        gap_count=0,
    )
    events = []

    async def emit(event, data):
        events.append((event, data))

    result = await QuestionRunner(model=model).run(
        request=QuestionInput(
            message="fact?", model="vision", context=context, history=[]
        ),
        emit=emit,
        cancelled=lambda: False,
    )
    assert result.answer == "fact"
    assert result.completed_ids == ["f1"]
    assert result.unused_ids == ["f2"]
    assert [call[0] for call in model.calls] == ["evaluate", "read", "evaluate"]
    assert [event for event, _ in events if event == "browser_note"] == ["browser_note"]
    activity = activity_events(events)
    assert event_values(activity, "state") == [
        "checking",
        "reading",
        "reading",
        "checking",
    ]
    reading_events = events_in_state(activity, "reading")
    assert event_values(reading_events, "tool_state") == ["running", "completed"]
    assert event_values(reading_events, "tool_id") == ["f1", "f1"]
    assert event_values(reading_events, "view_index") == [1, 1]
    assert event_values(reading_events, "view_count") == [2, 2]
    assert reading_events[1]["note_chars"] == len("page fact")
    assert context.notes == []


@pytest.mark.anyio
async def test_broad_question_must_settle_every_frame_and_reject_unknown_evidence():
    model = ScriptedModel(
        [
            EvaluationResult(decision="answer", answer="early", requires_complete=True),
            EvaluationResult(
                decision="answer", answer="invented", evidence_ids=["foreign"]
            ),
        ]
    )
    context = BrowserContext.model_construct(
        session_id=uuid4(),
        generation=1,
        cutoff=1,
        summary="",
        notes=[],
        pending_frames=[frame(1)],
        current_view=None,
        gap_count=0,
    )

    async def emit(event, data):
        pass

    result = await QuestionRunner(model=model).run(
        request=QuestionInput(
            message="summarize everything", model="vision", context=context, history=[]
        ),
        emit=emit,
        cancelled=lambda: False,
    )
    assert result.answer != "invented"
    assert result.completed_ids == ["f1"]
    assert result.unused_ids == []
    assert "enough" in result.answer


@pytest.mark.anyio
async def test_insufficient_rechecks_after_reading_pending_image():
    model = ScriptedModel(
        [
            EvaluationResult(decision="insufficient"),
            EvaluationResult(decision="insufficient"),
            EvaluationResult(decision="answer", answer="found it", evidence_ids=["f2"]),
        ]
    )
    context = BrowserContext(
        session_id=uuid4(), generation=1, cutoff=2, pending_frames=[frame(1), frame(2)]
    )

    async def emit(event, data):
        pass

    result = await QuestionRunner(model=model).run(
        request=QuestionInput(
            message="unseen?", model="vision", context=context, history=[]
        ),
        emit=emit,
        cancelled=lambda: False,
    )
    assert result.answer == "found it"
    assert [call[0] for call in model.calls] == [
        "evaluate",
        "read",
        "evaluate",
        "read",
        "evaluate",
    ]
    assert result.completed_ids == ["f1", "f2"]
    assert result.unused_ids == []


@pytest.mark.anyio
async def test_broad_question_settles_pending_even_if_model_scope_flag_is_false():
    model = ScriptedModel(
        [
            EvaluationResult(
                decision="answer", answer="premature", evidence_ids=["known"]
            ),
            EvaluationResult(
                decision="answer", answer="complete", evidence_ids=["known", "f1"]
            ),
        ]
    )
    context = BrowserContext(
        session_id=uuid4(),
        generation=1,
        cutoff=2,
        notes=[BrowserNote(id="known", sequence=2, text="first fact", model="vision")],
        pending_frames=[frame(1)],
    )

    async def emit(event, data):
        pass

    result = await QuestionRunner(model=model).run(
        request=QuestionInput(
            message="Summarize everything I shared",
            model="vision",
            context=context,
            history=[],
        ),
        emit=emit,
        cancelled=lambda: False,
    )
    assert result.answer == "complete"
    assert result.completed_ids == ["f1"]
    assert result.unused_ids == []


@pytest.mark.anyio
@pytest.mark.parametrize(
    "request_text",
    [
        "Give me the full list of visible items",
        "Give me the complete list of visible items",
    ],
    ids=["full-list", "complete-list"],
)
async def test_full_list_question_settles_pending_even_if_model_scope_flag_is_false(
    request_text,
):
    model = ScriptedModel(
        [
            EvaluationResult(
                decision="answer", answer="premature", evidence_ids=["known"]
            ),
            EvaluationResult(
                decision="answer", answer="complete", evidence_ids=["known", "f1"]
            ),
        ]
    )
    context = BrowserContext(
        session_id=uuid4(),
        generation=1,
        cutoff=2,
        notes=[BrowserNote(id="known", sequence=2, text="first item", model="vision")],
        pending_frames=[frame(1)],
    )

    async def emit(event, data):
        pass

    result = await QuestionRunner(model=model).run(
        request=QuestionInput(
            message=request_text,
            model="vision",
            context=context,
            history=[],
        ),
        emit=emit,
        cancelled=lambda: False,
    )

    assert result.answer == "complete"
    assert result.completed_ids == ["f1"]
    assert result.unused_ids == []


@pytest.mark.anyio
async def test_broad_insufficient_still_settles_the_frozen_batch():
    model = ScriptedModel(
        [
            EvaluationResult(decision="insufficient"),
            EvaluationResult(decision="answer", answer="complete", evidence_ids=["f1"]),
        ]
    )
    context = BrowserContext(
        session_id=uuid4(), generation=1, cutoff=1, pending_frames=[frame(1)]
    )

    async def emit(event, data):
        pass

    result = await QuestionRunner(model=model).run(
        request=QuestionInput(
            message="Summarize everything", model="vision", context=context, history=[]
        ),
        emit=emit,
        cancelled=lambda: False,
    )
    assert result.answer == "complete"
    assert result.completed_ids == ["f1"]


@pytest.mark.anyio
async def test_note_backed_answer_requires_a_nonempty_known_identifier():
    model = ScriptedModel(
        [EvaluationResult(decision="answer", answer="unsupported", evidence_ids=[])]
    )
    context = BrowserContext(
        session_id=uuid4(),
        generation=1,
        cutoff=1,
        notes=[
            BrowserNote(id="known", sequence=1, text="unrelated fact", model="vision")
        ],
    )

    async def emit(event, data):
        pass

    result = await QuestionRunner(model=model).run(
        request=QuestionInput(
            message="unseen fact?", model="vision", context=context, history=[]
        ),
        emit=emit,
        cancelled=lambda: False,
    )
    assert result.answer != "unsupported"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("evaluation", "message", "expected"),
    [
        (
            EvaluationResult(
                decision="answer",
                answer="A question mark ends a direct question.",
                answer_basis="general",
            ),
            "What punctuation ends a question?",
            "A question mark ends a direct question.",
        ),
        (
            EvaluationResult(
                decision="insufficient",
                answer="The page says the account is verified.",
                evidence_ids=["foreign"],
            ),
            "Is the account verified?",
            "I don't have enough reliable information to answer that yet.",
        ),
    ],
    ids=["general-answer", "insufficient-does-not-leak-claim"],
)
async def test_empty_browser_context_returns_only_safe_answers(
    evaluation, message, expected
):
    model = ScriptedModel([evaluation])
    context = BrowserContext(session_id=uuid4(), generation=1, cutoff=0)

    async def emit(_event, _data):
        pass

    result = await QuestionRunner(model=model).run(
        request=QuestionInput(
            message=message,
            model="vision",
            context=context,
            history=[],
        ),
        emit=emit,
        cancelled=lambda: False,
    )

    assert result.answer == expected


@pytest.mark.anyio
async def test_general_comparison_does_not_wait_for_unrelated_pending_browser_view():
    model = ScriptedModel(
        [
            EvaluationResult(
                decision="answer",
                answer="Lists are ordered and tuples are immutable.",
                answer_basis="general",
                requires_complete=True,
            )
        ]
    )
    context = BrowserContext(
        session_id=uuid4(), generation=1, cutoff=1, pending_frames=[frame(1)]
    )

    async def emit(_event, _data):
        pass

    result = await QuestionRunner(model=model).run(
        request=QuestionInput(
            message="Compare lists and tuples",
            model="vision",
            context=context,
            history=[],
        ),
        emit=emit,
        cancelled=lambda: False,
    )

    assert result.answer == "Lists are ordered and tuples are immutable."
    assert [call[0] for call in model.calls] == ["evaluate"]


@pytest.mark.anyio
async def test_conversation_answer_cannot_claim_foreign_browser_evidence():
    note = BrowserNote(id="known", sequence=1, text="A note", model="vision")
    model = ScriptedModel(
        [
            EvaluationResult(
                decision="answer",
                answer="Based on the discussion, use option A.",
                answer_basis="conversation",
                evidence_ids=["foreign"],
            )
        ]
    )
    context = BrowserContext(session_id=uuid4(), generation=1, cutoff=1, notes=[note])

    async def emit(_event, _data):
        pass

    result = await QuestionRunner(model=model).run(
        request=QuestionInput(
            message="What option did we discuss?",
            model="vision",
            context=context,
            history=[],
        ),
        emit=emit,
        cancelled=lambda: False,
    )

    assert result.answer != "Based on the discussion, use option A."


@pytest.mark.anyio
async def test_grounded_partial_answer_survives_capture_gap_after_batch_drains():
    model = ScriptedModel(
        [
            EvaluationResult(
                decision="answer",
                answer="The visible heading is Checkout.",
                evidence_ids=["known"],
                requires_complete=True,
            )
        ]
    )
    context = BrowserContext(
        session_id=uuid4(),
        generation=1,
        cutoff=1,
        notes=[BrowserNote(id="known", sequence=1, text="Checkout", model="vision")],
        gap_count=2,
    )

    async def emit(_event, _data):
        pass

    result = await QuestionRunner(model=model).run(
        request=QuestionInput(
            message="Summarize everything visible",
            model="vision",
            context=context,
            history=[],
        ),
        emit=emit,
        cancelled=lambda: False,
    )

    assert result.answer == "The visible heading is Checkout."


@pytest.mark.anyio
@pytest.mark.parametrize(
    "text,shortened",
    [
        ("Staff IDs start with stf_. The base URL is ${DJANOS_API_URL}.", False),
        ("x" * 600, False),
        ("🧭" * 601, True),
    ],
    ids=["short", "exact-limit", "unicode-overflow"],
)
async def test_read_result_exposes_bounded_description_without_truncating_memory(
    text, shortened
):
    model = ScriptedModel(
        [
            EvaluationResult(decision="wait"),
            EvaluationResult(
                decision="answer", answer="The supplied detail.", evidence_ids=["f1"]
            ),
        ],
        note_text=text,
    )
    events = []

    async def emit(event, data):
        events.append((event, data))

    result = await QuestionRunner(model=model).run(
        request=QuestionInput(
            message="What did this image show?",
            model="vision",
            context=BrowserContext(
                session_id=uuid4(), generation=1, cutoff=1, pending_frames=[frame(1)]
            ),
            history=[],
        ),
        emit=emit,
        cancelled=lambda: False,
    )
    read = events_in_state(activity_events(events), "reading")
    assert read[1]["preview_truncated"] is shortened
    assert len(read[1]["note_preview"]) <= 600
    assert "note_preview" not in read[0]
    assert model.calls[-1][1].notes[0].text == text
    assert result.completed_ids == ["f1"]
    if shortened:
        assert read[1]["note_preview"].endswith("…")
    else:
        assert read[1]["note_preview"] == text
