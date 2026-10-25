"""Bounded request-local evaluation and sequential pending-image reading."""

import asyncio
import logging
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import uuid4

from pydantic import ValidationError

from app.observation.model import ObservationModelError
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

INSUFFICIENT = "I don't have enough reliable information to answer that yet."
MAX_NOTE_PREVIEW_CHARS = 600
logger = logging.getLogger(__name__)
Emit = Callable[[str, dict[str, Any]], Awaitable[None]]
READ_FAILURE_MESSAGES = {
    "input_budget": "The reading input exceeds the model's allowance.",
    "budget_unavailable": "The selected model's input budget could not be verified.",
    "reader_timeout": "Reading the shared view timed out.",
    "memory_rejected": "The shared view exceeds the browser memory limit.",
    "output_truncated": "The model response was truncated.",
    "invalid_output": "The model returned invalid reading data.",
    "provider_error": "The reading provider is unavailable.",
    "read_failed": "The shared view could not be read.",
}
MODEL_FAILURE_KINDS = {
    "Observation model call timed out": "timeout",
    "Observation model response was truncated": "truncated",
    "Observation model returned invalid note data": "invalid_output",
    "Observation model returned invalid evaluation data": "invalid_output",
    "Observation model returned invalid JSON": "invalid_output",
    "Observation model returned an invalid response": "invalid_output",
    "Observation model response is invalid": "invalid_output",
    "Observation model response is too large": "invalid_output",
    "Observation model provider is unavailable": "provider_error",
    "Observation model provider returned an error": "provider_error",
}
READ_FAILURE_CODES_BY_KIND = {
    "timeout": "reader_timeout",
    "truncated": "output_truncated",
    "invalid_output": "invalid_output",
    "provider_error": "provider_error",
}
EVALUATION_FAILURE_CODES_BY_KIND = {
    "timeout": "evaluation_timeout",
    "truncated": "evaluation_truncated",
    "invalid_output": "evaluation_invalid_output",
    "provider_error": "evaluation_provider_error",
}
EVALUATION_FAILURE_MESSAGES = {
    "input_budget": "The evaluation input exceeds the model's allowance.",
    "budget_unavailable": "The selected model's input budget could not be verified.",
    "evaluation_timeout": "The answer evaluation timed out.",
    "evaluation_truncated": "The answer evaluation response was truncated.",
    "evaluation_invalid_output": "The answer evaluation returned invalid data.",
    "evaluation_provider_error": "The answer provider is unavailable.",
    "evaluation_failed": "The answer evaluation failed.",
}


class MemoryRejectedError(RuntimeError):
    """A parsed note could not fit the bounded browser memory."""


class QuestionFailure(RuntimeError):
    """A safe, classified failure from question evaluation or answer saving."""

    def __init__(
        self, *, phase: str, failure_code: str, message: str, exception_class: str
    ) -> None:
        super().__init__(message)
        self.phase = phase
        self.failure_code = failure_code
        self.public_message = message
        self.exception_class = exception_class


class ReadingModel(Protocol):
    async def read(self, *, request: ReadRequest) -> BrowserNote: ...

    async def evaluate(self, *, request: EvaluationInput) -> EvaluationResult: ...


@dataclass(frozen=True)
class QuestionInput:
    message: str
    model: str
    context: BrowserContext
    history: list[dict[str, Any]]
    progress: "QuestionResult | None" = None


@dataclass
class QuestionResult:
    answer: str = INSUFFICIENT
    completed_ids: list[str] = field(default_factory=list)
    failed_ids: list[str] = field(default_factory=list)
    unused_ids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ReadingProgress:
    frame: BrowserFrame
    view_index: int
    view_count: int
    started_at: float


@dataclass(frozen=True)
class ReadStatusUpdate:
    progress: ReadingProgress
    state: str
    note: BrowserNote | None = None
    details: dict[str, Any] | None = None


class QuestionRunner:
    def __init__(
        self,
        *,
        model: ReadingModel,
        inspect_budget: Callable[..., dict[str, Any] | None] | None = None,
    ) -> None:
        self._model = model
        self._inspect_budget = inspect_budget

    async def run(
        self, *, request: QuestionInput, emit: Emit, cancelled: Callable[[], bool]
    ) -> QuestionResult:
        context = request.context.model_copy(deep=True)
        pending = list(context.pending_frames)
        broad = bool(
            re.search(
                r"\b(all|every|everything|entire|whole|(?:full|complete)\s+list|summari[sz]e|compare|comparison)\b",
                request.message,
                re.IGNORECASE,
            )
        )
        result = request.progress or QuestionResult(
            unused_ids=[frame.id for frame in pending]
        )
        for index in range(len(pending) + 1):
            self._check_cancelled(cancelled)
            await self._activity(
                emit=emit, state="checking", message="Preparing an answer."
            )
            evaluation = await self._evaluate(
                request=EvaluationInput(
                    message=request.message,
                    model=request.model,
                    context=context,
                    history=request.history,
                ),
                emit=emit,
            )
            self._check_cancelled(cancelled)
            remaining = pending[index:]
            if evaluation.answer_basis in {"browser", "mixed"}:
                evaluation.requires_complete = evaluation.requires_complete or broad
            if self._can_answer(
                evaluation=evaluation, context=context, remaining=bool(remaining)
            ):
                result.answer = evaluation.answer
                return result
            if _terminal_insufficient(remaining=bool(remaining)):
                return result
            await self._read_next(
                request=request,
                context=context,
                state=(result, emit, cancelled),
                view=(index + 1, len(pending)),
            )
        return result

    async def _evaluate(
        self, *, request: EvaluationInput, emit: Emit
    ) -> EvaluationResult:
        if self._inspect_budget is not None:
            budget = self._inspect_budget(request=request)
            if budget is not None:
                await emit("browser_budget", budget)
        try:
            return await self._model.evaluate(request=request)
        except Exception as error:
            if isinstance(error, ObservationInputBudgetError):
                raise
            failure_code = _evaluation_failure_code(error=error)
            raise QuestionFailure(
                phase="evaluation",
                failure_code=failure_code,
                message=EVALUATION_FAILURE_MESSAGES[failure_code],
                exception_class=type(error).__name__,
            ) from None

    async def _read_next(
        self,
        *,
        request: QuestionInput,
        context: BrowserContext,
        state: tuple[QuestionResult, Emit, Callable[[], bool]],
        view: tuple[int, int],
    ) -> None:
        result, emit, cancelled = state
        frame = context.pending_frames[0]
        view_index, view_count = view
        progress = ReadingProgress(
            frame=frame,
            view_index=view_index,
            view_count=view_count,
            started_at=time.monotonic(),
        )
        await self._emit_read_status(
            emit=emit, update=ReadStatusUpdate(progress=progress, state="running")
        )
        result.unused_ids.remove(frame.id)
        result.failed_ids.append(frame.id)
        try:
            note = await self._read_note(
                request=request, context=context, frame=frame, state=state
            )
            await self._emit_read_status(
                emit=emit,
                update=ReadStatusUpdate(
                    progress=progress, state="completed", note=note
                ),
            )
            result.failed_ids.remove(frame.id)
            result.completed_ids.append(frame.id)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            context.gap_count += 1
            failure_code, failure_message = _read_failure(error=error)
            duration_ms = round((time.monotonic() - progress.started_at) * 1000)
            logger.warning(
                "Browser reading failed: frame_id=%s failure_code=%s exception_class=%s duration_ms=%d",
                frame.id,
                failure_code,
                type(error).__name__,
                duration_ms,
            )
            await self._emit_read_status(
                emit=emit,
                update=ReadStatusUpdate(
                    progress=progress,
                    state="failed",
                    details={
                        "failure_code": failure_code,
                        "failure_message": failure_message,
                    },
                ),
            )
            await self._activity(
                emit=emit,
                state="incomplete",
                message="A shared view could not be read.",
            )
        context.pending_frames = context.pending_frames[1:]

    async def _read_note(
        self,
        *,
        request: QuestionInput,
        context: BrowserContext,
        frame: BrowserFrame,
        state: tuple[QuestionResult, Emit, Callable[[], bool]],
    ) -> BrowserNote:
        result, emit, cancelled = state
        note = await self._model.read(
            request=ReadRequest(operation_id=uuid4(), model=request.model, frame=frame)
        )
        self._check_cancelled(cancelled)
        try:
            BrowserMemory(summary=context.summary, notes=[*context.notes, note])
        except ValidationError:
            raise MemoryRejectedError from None
        context.notes.append(note)
        await emit("browser_note", note.model_dump(mode="json"))
        return note

    @classmethod
    async def _emit_read_status(
        cls,
        *,
        emit: Emit,
        update: ReadStatusUpdate,
    ) -> None:
        progress = update.progress
        event_details: dict[str, Any] = {
            "tool_id": progress.frame.id,
            "tool_state": update.state,
            "view_index": progress.view_index,
            "view_count": progress.view_count,
            "duration_ms": round((time.monotonic() - progress.started_at) * 1000),
        }
        if update.note is not None:
            shortened = len(update.note.text) > MAX_NOTE_PREVIEW_CHARS
            event_details.update(
                {
                    "note_chars": len(update.note.text),
                    "note_preview": (
                        update.note.text[: MAX_NOTE_PREVIEW_CHARS - 1] + "…"
                    )
                    if shortened
                    else update.note.text,
                    "preview_truncated": shortened,
                }
            )
        if update.details is not None:
            event_details.update(update.details)
        await cls._activity(
            emit=emit,
            state="reading",
            message="Reading shared view.",
            details=event_details,
        )

    @staticmethod
    async def _activity(
        *,
        emit: Emit,
        state: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        data: dict[str, Any] = {"state": state, "message": message}
        if details is not None:
            data.update(details)
        await emit("browser_activity", data)

    @staticmethod
    def _check_cancelled(cancelled: Callable[[], bool]) -> None:
        if cancelled():
            raise asyncio.CancelledError

    @staticmethod
    def _can_answer(
        *, evaluation: EvaluationResult, context: BrowserContext, remaining: bool
    ) -> bool:
        if evaluation.decision != "answer":
            return False
        if not evaluation.answer.strip():
            return False
        if not _valid_evidence(evaluation=evaluation, context=context):
            return False
        if evaluation.answer_basis in {"conversation", "general"}:
            return True
        if not evaluation.requires_complete:
            return True
        return not remaining


def _valid_evidence(*, evaluation: EvaluationResult, context: BrowserContext) -> bool:
    ids = {note.id for note in context.notes}
    if context.current_view is not None:
        ids.add(context.current_view.id)
    supplied_ids = set(evaluation.evidence_ids)
    if not supplied_ids.issubset(ids):
        return False
    if evaluation.answer_basis in {"conversation", "general"}:
        return not supplied_ids
    return bool(supplied_ids or context.summary.strip())


def _terminal_insufficient(*, remaining: bool) -> bool:
    return not remaining


def _evaluation_failure_code(*, error: Exception) -> str:
    if isinstance(error, ObservationInputBudgetError):
        return (
            "input_budget"
            if error.reason == "input_too_large"
            else "budget_unavailable"
        )
    if isinstance(error, TimeoutError):
        return "evaluation_timeout"
    if isinstance(error, ObservationModelError):
        kind = _model_failure_kind(error=error)
        return EVALUATION_FAILURE_CODES_BY_KIND.get(kind, "evaluation_failed")
    return "evaluation_failed"


def _read_failure(*, error: Exception) -> tuple[str, str]:
    failure_code = "read_failed"
    if isinstance(error, ObservationInputBudgetError):
        failure_code = (
            "input_budget"
            if error.reason == "input_too_large"
            else "budget_unavailable"
        )
    elif isinstance(error, TimeoutError):
        failure_code = "reader_timeout"
    elif isinstance(error, MemoryRejectedError):
        failure_code = "memory_rejected"
    elif isinstance(error, ObservationModelError):
        failure_code = _model_read_failure_code(error=error)
    return failure_code, READ_FAILURE_MESSAGES[failure_code]


def _model_read_failure_code(*, error: ObservationModelError) -> str:
    kind = _model_failure_kind(error=error)
    return READ_FAILURE_CODES_BY_KIND.get(kind, "read_failed")


def _model_failure_kind(*, error: ObservationModelError) -> str:
    if len(error.args) != 1 or not isinstance(error.args[0], str):
        return "unknown"
    return MODEL_FAILURE_KINDS.get(error.args[0], "unknown")
