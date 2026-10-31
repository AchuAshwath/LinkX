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


@dataclass(frozen=True)
class TranscriptTurnResult:
    status: Literal["started", "completed", "conflict", "missing"]
    user_message_id: str
    assistant_message_id: str
    history: list[dict[str, Any]]
    answer: str | None = None


@dataclass(frozen=True)
class TranscriptCompletionResult:
    status: Literal["saved", "already_completed", "cancelled", "conflict", "missing"]
    answer: str | None = None


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
    status: Literal["started", "completed", "conflict", "missing"],
    request: TranscriptTurnRequest,
    history: list[dict[str, Any]] | None = None,
    answer: str | None = None,
) -> TranscriptTurnResult:
    return TranscriptTurnResult(
        status=status,
        user_message_id=request.user_message_id,
        assistant_message_id=request.assistant_message_id,
        history=history or [],
        answer=answer,
    )


def _existing_turn_result(
    *,
    user: dict[str, Any] | None,
    assistant: dict[str, Any] | None,
    request: TranscriptTurnRequest,
) -> TranscriptTurnResult | None:
    if user is None and assistant is None:
        return None
    completed = (
        assistant is not None
        and assistant.get("role") == "assistant"
        and assistant.get("parent_id") == request.user_message_id
        and _matches_user_message(message=user, request=request)
    )
    if not completed:
        return _result(status="conflict", request=request)
    assert assistant is not None
    return _result(
        status="completed",
        request=request,
        answer=_answer_text(assistant),
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
    return _result(status="started", request=request, history=history_copy)


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
        return TranscriptCompletionResult(
            status="already_completed",
            answer=_answer_text(assistant),
        )
    return TranscriptCompletionResult(status="conflict")


def complete_transcript_turn(
    *,
    session: Session,
    request: TranscriptTurnRequest,
    completion: CompletionPayload,
) -> TranscriptCompletionResult:
    """Append one assistant text only while the request user remains the active leaf."""
    thread = _locked_thread(session=session, thread_id=request.thread_id)
    if thread is None:
        session.rollback()
        return TranscriptCompletionResult(status="missing")

    transcript = copy.deepcopy(thread.transcript or {})
    messages = list(transcript.get("messages", []))
    by_id = _message_map(messages)
    existing = _existing_completion_result(
        assistant=by_id.get(request.assistant_message_id),
        request=request,
    )
    if existing is not None:
        session.rollback()
        return existing

    target = _find_completion_target(thread=thread, request=request)
    if target is None or thread.active_leaf_id != request.user_message_id:
        session.rollback()
        return TranscriptCompletionResult(status="conflict")

    assistant_message = {
        "id": request.assistant_message_id,
        "role": "assistant",
        "parent_id": request.user_message_id,
        "parts": [{"type": "text", "text": completion.answer}],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    messages.append(assistant_message)
    transcript["messages"] = messages
    transcript["active_leaf_id"] = request.assistant_message_id
    thread.transcript = transcript
    thread.active_leaf_id = request.assistant_message_id
    thread.message_count = len(messages)
    thread.updated_at = datetime.now(timezone.utc)
    session.add(thread)
    if completion.cancelled():
        session.rollback()
        return TranscriptCompletionResult(status="cancelled")

    session.commit()
    return TranscriptCompletionResult(status="saved", answer=completion.answer)
