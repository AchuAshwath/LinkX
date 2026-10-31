"""Request-bound browser questions using ordinary durable chat turns."""

import asyncio
import logging
from collections.abc import AsyncGenerator, AsyncIterator, Callable
from dataclasses import asdict, dataclass, field
from typing import Any, NoReturn
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.api.routes import ai_threads
from app.api.routes.ai_threads import _get_owned_thread
from app.core.db import engine
from app.models import ChatThread
from app.observation.broker import (
    Invocation,
    InvocationRequest,
    LaneBusy,
    feature_broker,
)
from app.observation.model import BrowserModel
from app.observation.persistence import (
    CompletionPayload,
    TranscriptTurnRequest,
    TranscriptTurnResult,
    begin_transcript_turn,
    complete_transcript_turn,
)
from app.observation.question import (
    QuestionFailure,
    QuestionInput,
    QuestionResult,
    QuestionRunner,
)
from app.observation.schemas import BrowserChatRequest, EvaluationInput
from app.observation.thread_guard import thread_guard
from app.services.ai_chat_runner import format_sse
from app.services.ai_observation_budget import ObservationInputBudgetError
from app.services.ai_turn_accumulator import resolve_active_branch

router = APIRouter(prefix="/ai/threads", tags=["ai-browser-chat"])
browser_model = BrowserModel()
logger = logging.getLogger(__name__)
TITLE_GENERATION_TIMEOUT_SECONDS = 3
TRANSCRIPT_SAVE_MESSAGE = (
    "The browser answer could not be saved. Refresh the chat to check its saved answer."
)


def _save_question_answer(
    *,
    turn: TranscriptTurnRequest,
    result: QuestionResult,
    cancelled: Callable[[], bool],
) -> str:
    try:
        with Session(engine) as session:
            saved = complete_transcript_turn(
                session=session,
                request=turn,
                completion=CompletionPayload(answer=result.answer, cancelled=cancelled),
            )
    except Exception as error:
        raise QuestionFailure(
            phase="transcript_save",
            failure_code="transcript_unsaved",
            message=TRANSCRIPT_SAVE_MESSAGE,
            exception_class=type(error).__name__,
        ) from None
    if saved.status not in ("saved", "already_completed"):
        raise QuestionFailure(
            phase="transcript_save",
            failure_code="transcript_unsaved",
            message=TRANSCRIPT_SAVE_MESSAGE,
            exception_class="TranscriptTurnNotSaved",
        )
    return saved.answer or result.answer


def _is_ai_title_eligible(*, thread: ChatThread | None) -> bool:
    if thread is None or thread.is_custom_title:
        return False
    return thread.message_count <= 2


def _apply_generated_title(*, thread_id: UUID, ai_title: str | None) -> None:
    with Session(engine) as session:
        statement = (
            select(ChatThread)
            .where(ChatThread.id == thread_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        thread = session.exec(statement).first()
        if thread is None:
            return
        crud.apply_ai_thread_title(
            session=session,
            db_thread=thread,
            ai_title=ai_title,
        )


@dataclass
class BrowserQuestionJob:
    owner_id: UUID
    body: BrowserChatRequest
    turn: TranscriptTurnRequest
    history: list[dict[str, Any]]
    guard_token: str
    budget: dict[str, Any] | None = None
    events: asyncio.Queue[tuple[str, dict[str, Any]]] = field(
        default_factory=asyncio.Queue
    )
    completed_ids: list[str] = field(default_factory=list)
    result: QuestionResult | None = None
    completed: bool = False

    async def run(self, invocation: Invocation) -> QuestionResult:
        try:

            async def emit(event: str, data: dict[str, Any]) -> None:
                if invocation.cancelled:
                    raise asyncio.CancelledError
                if event == "browser_note":
                    self.completed_ids.append(data["id"])
                self.events.put_nowait((event, data))

            self.result = QuestionResult(
                unused_ids=[
                    frame.id for frame in self.body.browser_context.pending_frames
                ]
            )
            self.result = await QuestionRunner(
                model=browser_model, inspect_budget=browser_model.preflight
            ).run(
                request=QuestionInput(
                    message=self.body.message,
                    model=self.body.model,
                    context=self.body.browser_context,
                    history=self.history,
                    progress=self.result,
                ),
                emit=emit,
                cancelled=lambda: invocation.cancelled,
            )
            self.result.answer = _save_question_answer(
                turn=self.turn,
                result=self.result,
                cancelled=lambda: invocation.cancelled,
            )
            self.completed = True
            return self.result
        finally:
            thread_guard.release(thread_id=self.turn.thread_id, token=self.guard_token)

    async def generate_title(self) -> None:
        if self.result is None or not self.completed:
            return
        with Session(engine) as session:
            thread = session.get(ChatThread, self.turn.thread_id)
            if not _is_ai_title_eligible(thread=thread):
                return
        try:
            title = await ai_threads.generate_ai_thread_title(
                user_prompt=self.body.message.strip() or "Browser question",
                assistant_response=self.result.answer,
                model=self.body.model,
            )
        except Exception:
            return
        _apply_generated_title(thread_id=self.turn.thread_id, ai_title=title)

    def receipt(self) -> dict[str, Any]:
        original = [frame.id for frame in self.body.browser_context.pending_frames]
        if self.result is not None:
            completed = self.result.completed_ids
            failed = self.result.failed_ids
            unused = self.result.unused_ids
        else:
            completed = self.completed_ids
            failed = [frame_id for frame_id in original if frame_id not in completed]
            unused = []
        return {
            "operation_id": str(self.body.request_id),
            "completed_ids": completed,
            "failed_ids": failed,
            "unused_ids": unused,
        }


@dataclass(frozen=True)
class BrowserChatStart:
    session: Session
    current_user: CurrentUser
    thread: ChatThread
    body: BrowserChatRequest
    turn: TranscriptTurnRequest
    guard_token: str


async def _events(
    *, job: BrowserQuestionJob, invocation: Invocation
) -> AsyncGenerator[str, None]:
    task = invocation.task
    assert task is not None
    try:
        async for event in _progress_events(job=job, task=task):
            yield event
        async for event in _result_events(job=job, task=task):
            yield event
    except (asyncio.CancelledError, GeneratorExit):
        feature_broker.cancel(owner_id=job.owner_id, operation_id=job.body.request_id)
        raise
    except ObservationInputBudgetError as error:
        detail = _budget_error_detail(error)
        detail["operation_id"] = str(job.body.request_id)
        logger.warning(
            "Browser question failed: operation_id=%s phase=evaluation failure_code=%s exception_class=%s",
            job.body.request_id,
            error.reason,
            type(error).__name__,
        )
        yield format_sse(event="error", data=detail)
    except QuestionFailure as error:
        logger.warning(
            "Browser question failed: operation_id=%s phase=%s failure_code=%s exception_class=%s",
            job.body.request_id,
            error.phase,
            error.failure_code,
            error.exception_class,
        )
        yield format_sse(
            event="error",
            data={
                "operation_id": str(job.body.request_id),
                "code": error.failure_code,
                "message": error.public_message,
            },
        )
    except Exception as error:
        logger.warning(
            "Browser processing failed: operation_id=%s phase=unknown failure_code=browser_processing_failed exception_class=%s",
            job.body.request_id,
            type(error).__name__,
        )
        yield format_sse(
            event="error",
            data={
                "operation_id": str(job.body.request_id),
                "code": "browser_processing_failed",
                "message": "Browser processing failed. Refresh the chat to check its saved answer.",
            },
        )


async def _progress_events(
    *, job: BrowserQuestionJob, task: asyncio.Task[Any]
) -> AsyncGenerator[str, None]:
    yield format_sse(
        event="browser_status",
        data={"state": "processing", "operation_id": str(job.body.request_id)},
    )
    if job.budget is not None:
        yield format_sse(event="browser_budget", data=job.budget)
    while not task.done():
        try:
            item = await asyncio.wait_for(job.events.get(), timeout=1)
            yield format_sse(event=item[0], data=item[1])
        except TimeoutError:
            yield ": ping\n\n"
    while not job.events.empty():
        item = job.events.get_nowait()
        yield format_sse(event=item[0], data=item[1])


async def _result_events(
    *, job: BrowserQuestionJob, task: asyncio.Task[Any]
) -> AsyncGenerator[str, None]:
    yield format_sse(event="browser_receipt", data=job.receipt())
    if task.cancelled():
        yield format_sse(event="error", data={"message": "Browser request was stopped"})
        return
    result = task.result()
    yield format_sse(event="text_delta", data={"content": result.answer})
    try:
        await asyncio.wait_for(
            job.generate_title(), timeout=TITLE_GENERATION_TIMEOUT_SECONDS
        )
    except TimeoutError:
        logger.debug("Browser title generation timed out")
    except Exception as error:
        logger.warning("Browser title generation failed (%s)", type(error).__name__)
    yield format_sse(event="done", data={})


async def _replay_answer(answer: str) -> AsyncGenerator[str, None]:
    yield format_sse(event="text_delta", data={"content": answer})
    yield format_sse(event="done", data={})


def _turn_request(
    *, thread_id: UUID, body: BrowserChatRequest
) -> TranscriptTurnRequest:
    return TranscriptTurnRequest(
        thread_id=thread_id,
        request_id=body.request_id,
        user_text=body.message,
        model=body.model,
    )


def _has_turn_message(*, thread: ChatThread, turn: TranscriptTurnRequest) -> bool:
    message_ids = _transcript_ids(thread=thread)
    return (
        turn.user_message_id in message_ids or turn.assistant_message_id in message_ids
    )


def _transcript_ids(*, thread: ChatThread) -> set[str]:
    messages = (thread.transcript or {}).get("messages", [])
    return {str(message.get("id")) for message in messages if isinstance(message, dict)}


def _admit_turn(
    *,
    session: Session,
    thread: ChatThread,
    body: BrowserChatRequest,
    turn: TranscriptTurnRequest,
) -> tuple[TranscriptTurnResult, dict[str, Any] | None]:
    if _has_turn_message(thread=thread, turn=turn):
        prior = begin_transcript_turn(session=session, request=turn)
        if prior.status == "completed":
            return prior, None
        raise HTTPException(
            status_code=409,
            detail="This request cannot be replayed; refresh the chat",
        )

    feature_broker.check_available(operation_id=body.request_id)
    history = resolve_active_branch(
        messages=(thread.transcript or {}).get("messages", []),
        active_leaf_id=thread.active_leaf_id,
    )
    budget = browser_model.preflight(
        request=EvaluationInput(
            message=body.message,
            model=body.model,
            context=body.browser_context,
            history=history,
        )
    )
    return begin_transcript_turn(session=session, request=turn), budget


def _streaming_question_response(
    *, job: BrowserQuestionJob, invocation: Invocation
) -> StreamingResponse:
    return _response(events=_events(job=job, invocation=invocation))


def _response(*, events: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(
        events,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _prepare_browser_chat(*, start: BrowserChatStart) -> StreamingResponse:
    session = start.session
    session.refresh(start.thread)

    async def work(invocation: Invocation) -> QuestionResult:
        return await job.run(invocation)

    started, budget = _admit_turn(
        session=session,
        thread=start.thread,
        body=start.body,
        turn=start.turn,
    )
    if started.status == "completed":
        thread_guard.release(
            thread_id=start.thread.id,
            token=start.guard_token,
        )
        return _response(events=_replay_answer(started.answer or ""))
    if started.status != "started":
        raise HTTPException(
            status_code=409,
            detail="This browser request cannot be replayed; refresh the chat",
        )

    job = BrowserQuestionJob(
        owner_id=start.current_user.id,
        body=start.body,
        turn=start.turn,
        history=started.history,
        guard_token=start.guard_token,
        budget=budget,
    )
    invocation = feature_broker.start(
        request=InvocationRequest(start.current_user.id, start.body.request_id, 240),
        work=work,
    )
    return _streaming_question_response(job=job, invocation=invocation)


def _release_and_raise(
    *, thread_id: UUID, token: str, error: BaseException
) -> NoReturn:
    thread_guard.release(thread_id=thread_id, token=token)
    if isinstance(error, ObservationInputBudgetError):
        detail = _budget_error_detail(error)
        logger.warning("Browser reading budget rejected: %s", detail)
        raise HTTPException(
            status_code=422,
            detail=detail,
        ) from None
    if isinstance(error, LaneBusy):
        raise HTTPException(
            status_code=409,
            detail="Browser processing is still settling",
        ) from None
    raise error


def _budget_error_detail(error: ObservationInputBudgetError) -> dict[str, Any]:
    message = (
        "The browser memory and question exceed this model's input allowance. "
        "Your browser notes are retained. Choose a larger-context model or shorten the question."
        if error.reason == "input_too_large"
        else "Cannot verify this model's context limit or token count. Choose a supported model and retry."
    )
    return {
        "code": error.reason,
        "message": message,
        "budget": asdict(error.budget) if error.budget else None,
    }


@router.post("/{id}/browser-chat")
async def browser_chat(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: UUID,
    body: BrowserChatRequest,
) -> StreamingResponse:
    thread = _get_owned_thread(session=session, current_user=current_user, thread_id=id)
    token = uuid4().hex
    if not thread_guard.acquire(thread_id=id, token=token):
        raise HTTPException(
            status_code=409, detail="This chat already has an active request"
        )
    turn = _turn_request(thread_id=id, body=body)
    try:
        return _prepare_browser_chat(
            start=BrowserChatStart(
                session=session,
                current_user=current_user,
                thread=thread,
                body=body,
                turn=turn,
                guard_token=token,
            )
        )
    except BaseException as error:
        _release_and_raise(thread_id=id, token=token, error=error)
