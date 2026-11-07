"""Short row-locked writes for ordinary text-only transcript turns."""

from __future__ import annotations

import copy
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from sqlmodel import Session, select

from app.crud import generate_thread_title
from app.models import ChatThread
from app.services.ai_stream_turn import sanitize_stream_parts
from app.services.ai_turn_accumulator import resolve_active_branch


@dataclass(frozen=True)
class TranscriptTurnRequest:
    thread_id: uuid.UUID
    request_id: uuid.UUID
    user_text: str
    model: str

    @property
    def user_message_id(self) -> str:
        return f"turn_{self.request_id.hex}_user"

    @property
    def assistant_message_id(self) -> str:
        return f"turn_{self.request_id.hex}_assistant"


@dataclass(frozen=True)
class CompletionPayload:
    answer: str
    cancelled: Callable[[], bool]
    parts: list[dict[str, Any]] | None = None
    interrupted: bool = False


@dataclass(frozen=True)
class TranscriptTurnResult:
    status: Literal["started", "completed", "interrupted", "conflict", "missing"]
    user_message_id: str
    assistant_message_id: str
    history: list[dict[str, Any]]
    answer: str | None = None
    parts: list[dict[str, Any]] | None = None


@dataclass(frozen=True)
class TranscriptCompletionResult:
    status: Literal[
        "saved", "already_completed", "interrupted", "cancelled", "conflict", "missing"
    ]
    answer: str | None = None
    parts: list[dict[str, Any]] | None = None
    interrupted: bool = False


@dataclass(frozen=True)
class _TurnResultValues:
    history: list[dict[str, Any]] | None = None
    answer: str | None = None
    parts: list[dict[str, Any]] | None = None


@dataclass(frozen=True)
class _CompletionParts:
    parts: list[dict[str, Any]]
    answer: str
    visible: bool


@dataclass(frozen=True)
class _CompletionState:
    thread: ChatThread
    transcript: dict[str, Any]
    messages: list[dict[str, Any]]


@dataclass(frozen=True)
class _CompletionWrite:
    request: TranscriptTurnRequest
    completion: CompletionPayload
    parts: _CompletionParts


def _locked_thread(*, session: Session, thread_id: uuid.UUID) -> ChatThread | None:
    statement = (
        select(ChatThread)
        .where(ChatThread.id == thread_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return session.exec(statement).first()


def _message_map(messages: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        str(message["id"]): message
        for message in messages
        if isinstance(message, dict) and message.get("id")
    }


def _answer_text(message: dict[str, Any]) -> str:
    parts = message.get("parts", [])
    return "".join(
        part.get("text", "")
        for part in parts
        if isinstance(part, dict)
        and part.get("type") == "text"
        and isinstance(part.get("text"), str)
    )


def _matches_user_message(
    *, message: dict[str, Any] | None, request: TranscriptTurnRequest
) -> bool:
    return bool(
        message
        and message.get("role") == "user"
        and message.get("parts") == [{"type": "text", "text": request.user_text}]
    )


def _maybe_title_thread(*, thread: ChatThread, user_text: str) -> None:
    default_titles = ("New conversation", "New Chat", "Untitled", "")
    if thread.is_custom_title or thread.title not in default_titles:
        return
    thread.title = generate_thread_title(user_text)


def _result(
    *,
    status: Literal["started", "completed", "interrupted", "conflict", "missing"],
    request: TranscriptTurnRequest,
    values: _TurnResultValues | None = None,
) -> TranscriptTurnResult:
    values = values or _TurnResultValues()
    return TranscriptTurnResult(
        status=status,
        user_message_id=request.user_message_id,
        assistant_message_id=request.assistant_message_id,
        history=copy.deepcopy(values.history or []),
        answer=values.answer,
        parts=sanitize_stream_parts(parts=values.parts or []),
    )


def _existing_turn_result(
    *,
    user: dict[str, Any] | None,
    assistant: dict[str, Any] | None,
    request: TranscriptTurnRequest,
) -> TranscriptTurnResult | None:
    if user is None and assistant is None:
        return None
    matching_assistant = (
        assistant is not None
        and assistant.get("role") == "assistant"
        and assistant.get("parent_id") == request.user_message_id
        and _matches_user_message(message=user, request=request)
    )
    if not matching_assistant:
        return _result(status="conflict", request=request)
    assert assistant is not None
    interrupted = bool(assistant.get("interrupted"))
    parts = _sanitized_message_parts(message=assistant)
    return _result(
        status="interrupted" if interrupted else "completed",
        request=request,
        values=_TurnResultValues(
            answer=_answer_text({"parts": parts}),
            parts=parts,
        ),
    )


def begin_transcript_turn(
    *, session: Session, request: TranscriptTurnRequest
) -> TranscriptTurnResult:
    """Append a deterministic text-only user message and capture its old branch."""
    thread = _locked_thread(session=session, thread_id=request.thread_id)
    if thread is None:
        session.rollback()
        return _result(status="missing", request=request)

    transcript = copy.deepcopy(thread.transcript or {})
    messages = list(transcript.get("messages", []))
    by_id = _message_map(messages)
    user = by_id.get(request.user_message_id)
    assistant = by_id.get(request.assistant_message_id)
    duplicate = _existing_turn_result(
        user=user,
        assistant=assistant,
        request=request,
    )
    if duplicate is not None:
        session.rollback()
        return duplicate

    history = resolve_active_branch(
        messages=messages,
        active_leaf_id=thread.active_leaf_id,
    )
    history_copy = copy.deepcopy(history)
    user_message = {
        "id": request.user_message_id,
        "role": "user",
        "parent_id": thread.active_leaf_id,
        "parts": [{"type": "text", "text": request.user_text}],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    messages.append(user_message)
    transcript["messages"] = messages
    transcript["active_leaf_id"] = request.user_message_id
    thread.transcript = transcript
    thread.active_leaf_id = request.user_message_id
    thread.message_count = len(messages)
    thread.model = request.model
    _maybe_title_thread(thread=thread, user_text=request.user_text)
    thread.updated_at = datetime.now(timezone.utc)
    session.add(thread)
    session.commit()
    return _result(
        status="started",
        request=request,
        values=_TurnResultValues(history=history_copy),
    )


def _find_completion_target(
    *, thread: ChatThread, request: TranscriptTurnRequest
) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    transcript = copy.deepcopy(thread.transcript or {})
    messages = list(transcript.get("messages", []))
    by_id = _message_map(messages)
    user = by_id.get(request.user_message_id)
    if user is None or not _matches_user_message(message=user, request=request):
        return None
    return user, messages


def _existing_completion_result(
    *,
    assistant: dict[str, Any] | None,
    request: TranscriptTurnRequest,
) -> TranscriptCompletionResult | None:
    if assistant is None:
        return None
    if (
        assistant.get("role") == "assistant"
        and assistant.get("parent_id") == request.user_message_id
    ):
        parts = _sanitized_message_parts(message=assistant)
        return TranscriptCompletionResult(
            status="interrupted"
            if assistant.get("interrupted")
            else "already_completed",
            answer=_answer_text({"parts": parts}),
            parts=parts,
            interrupted=bool(assistant.get("interrupted")),
        )
    return TranscriptCompletionResult(status="conflict")


def _sanitized_message_parts(*, message: dict[str, Any]) -> list[dict[str, Any]]:
    parts = message.get("parts", [])
    if not isinstance(parts, list):
        return []
    return sanitize_stream_parts(parts=parts)


def _completion_parts(*, completion: CompletionPayload) -> _CompletionParts:
    raw_parts = completion.parts
    if raw_parts is None:
        raw_parts = [{"type": "text", "text": completion.answer}]
    parts = sanitize_stream_parts(parts=raw_parts)
    answer = _answer_text({"parts": parts})
    visible = any(
        isinstance(part, dict)
        and part.get("type")
        in {
            "text",
            "thought",
            "tool-call",
            "tool_call",
            "draft_artifact",
            "trending_artifact",
        }
        and (part.get("type") != "text" or bool(part.get("text")))
        for part in parts
    )
    return _CompletionParts(parts=parts, answer=answer, visible=visible)


def _completion_state(
    *, session: Session, request: TranscriptTurnRequest
) -> _CompletionState | None:
    thread = _locked_thread(session=session, thread_id=request.thread_id)
    if thread is None:
        return None
    transcript = copy.deepcopy(thread.transcript or {})
    return _CompletionState(
        thread=thread,
        transcript=transcript,
        messages=list(transcript.get("messages", [])),
    )


def _store_assistant_completion(
    *,
    session: Session,
    state: _CompletionState,
    write: _CompletionWrite,
) -> TranscriptCompletionResult:
    request = write.request
    completion = write.completion
    result = write.parts
    state.messages.append(
        {
            "id": request.assistant_message_id,
            "role": "assistant",
            "parent_id": request.user_message_id,
            "parts": result.parts,
            "created_at": datetime.now(timezone.utc).isoformat(),
            **({"interrupted": True} if completion.interrupted else {}),
        }
    )
    state.transcript["messages"] = state.messages
    state.transcript["active_leaf_id"] = request.assistant_message_id
    state.thread.transcript = state.transcript
    state.thread.active_leaf_id = request.assistant_message_id
    state.thread.message_count = len(state.messages)
    state.thread.updated_at = datetime.now(timezone.utc)
    session.add(state.thread)
    session.commit()
    return TranscriptCompletionResult(
        status="saved",
        answer=result.answer,
        parts=copy.deepcopy(result.parts),
        interrupted=completion.interrupted,
    )


def _completion_rejection(
    *,
    state: _CompletionState,
    request: TranscriptTurnRequest,
    completion: CompletionPayload,
    result: _CompletionParts,
) -> Literal["conflict", "cancelled"] | None:
    target = _find_completion_target(thread=state.thread, request=request)
    if target is None or state.thread.active_leaf_id != request.user_message_id:
        return "conflict"
    if completion.interrupted and not result.visible:
        return "cancelled"
    if completion.cancelled() and not completion.interrupted:
        return "cancelled"
    return None


def complete_transcript_turn(
    *,
    session: Session,
    request: TranscriptTurnRequest,
    completion: CompletionPayload,
) -> TranscriptCompletionResult:
    """Append one assistant text only while the request user remains the active leaf."""
    state = _completion_state(session=session, request=request)
    if state is None:
        session.rollback()
        return TranscriptCompletionResult(status="missing")

    existing = _existing_completion_result(
        assistant=_message_map(state.messages).get(request.assistant_message_id),
        request=request,
    )
    if existing is not None:
        session.rollback()
        return existing

    result = _completion_parts(completion=completion)
    rejection = _completion_rejection(
        state=state,
        request=request,
        completion=completion,
        result=result,
    )
    if rejection is not None:
        session.rollback()
        return TranscriptCompletionResult(status=rejection)
    return _store_assistant_completion(
        session=session,
        state=state,
        write=_CompletionWrite(request=request, completion=completion, parts=result),
    )
