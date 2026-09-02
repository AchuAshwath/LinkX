import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    ChatMessageRequest,
    ChatThread,
    ChatThreadCreate,
    ChatThreadDetail,
    ChatThreadPublic,
    ChatThreadsPublic,
    ChatThreadUpdate,
    Message,
    Post,
)
from app.services.ai_chat_runner import default_chat_stream_runner, format_sse

router = APIRouter(prefix="/ai/threads", tags=["ai-threads"])


def _get_owned_thread(
    *, session: Session, current_user: CurrentUser, thread_id: uuid.UUID
) -> ChatThread:
    """Fetch thread and verify user ownership or superuser status."""
    thread = crud.get_chat_thread(session=session, thread_id=thread_id)
    if not thread:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat thread not found",
        )
    if not current_user.is_superuser and thread.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
    return thread


def _collect_stream_part(
    *,
    event_name: str,
    payload: dict[str, Any],
    assistant_parts: list[dict[str, Any]],
) -> str:
    """Append structured message parts and return text delta if present."""
    if event_name == "thought":
        assistant_parts.append(
            {"type": "thought", "content": payload.get("content", "")}
        )
    elif event_name == "text_delta":
        return str(payload.get("content", ""))
    elif event_name in {"tool_start", "tool_output"}:
        state = "running" if event_name == "tool_start" else "completed"
        part: dict[str, Any] = {
            "type": "tool_call",
            "name": payload.get("name"),
            "state": state,
        }
        if "input" in payload:
            part["input"] = payload["input"]
        if "output" in payload:
            part["output"] = payload["output"]
        assistant_parts.append(part)
    elif event_name == "draft_artifact":
        assistant_parts.append(
            {
                "type": "draft_artifact",
                "post_id": payload.get("post_id"),
                "content": payload.get("content"),
                "platform": payload.get("platform"),
            }
        )
    return ""


@router.post("/", response_model=ChatThreadDetail)
def create_chat_thread(
    *, session: SessionDep, current_user: CurrentUser, thread_in: ChatThreadCreate
) -> Any:
    """Create a new AI chat conversation thread."""
    if thread_in.post_id:
        post = session.get(Post, thread_in.post_id)
        if not post:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Linked post not found",
            )
        if not current_user.is_superuser and post.owner_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot link thread to another user's post",
            )

    return crud.create_chat_thread(
        session=session, thread_in=thread_in, owner_id=current_user.id
    )


@router.get("/", response_model=ChatThreadsPublic)
def list_chat_threads(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    archived: bool | None = None,
    skip: int = 0,
    limit: int = 100,
) -> Any:
    """List chat threads for the current user with optional archive filter."""
    threads, count = crud.get_chat_threads(
        session=session,
        owner_id=current_user.id,
        is_archived=archived,
        skip=skip,
        limit=limit,
    )
    return ChatThreadsPublic(data=threads, count=count)


@router.get("/{id}", response_model=ChatThreadDetail)
def get_chat_thread(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Any:
    """Get a chat thread by ID including full JSON transcript."""
    return _get_owned_thread(session=session, current_user=current_user, thread_id=id)


@router.patch("/{id}", response_model=ChatThreadPublic)
def update_chat_thread(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    thread_in: ChatThreadUpdate,
) -> Any:
    """Update chat thread metadata (title, archive status)."""
    thread = _get_owned_thread(session=session, current_user=current_user, thread_id=id)
    try:
        return crud.update_chat_thread(
            session=session, db_thread=thread, thread_in=thread_in
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@router.delete("/{id}", response_model=Message)
def delete_chat_thread(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Message:
    """Delete a chat thread."""
    _get_owned_thread(session=session, current_user=current_user, thread_id=id)
    crud.delete_chat_thread(session=session, thread_id=id)
    return Message(message="Chat thread deleted successfully")


@router.post("/{id}/chat")
async def chat_stream(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: ChatMessageRequest,
) -> StreamingResponse:
    """Server-Sent Events streaming endpoint for AI conversation."""
    thread = _get_owned_thread(session=session, current_user=current_user, thread_id=id)

    # 1. Append incoming user message to transcript immediately
    user_msg = {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "role": "user",
        "parts": [{"type": "text", "text": body.message}],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    crud.append_message_to_transcript(
        session=session, db_thread=thread, message=user_msg
    )

    async def event_generator() -> AsyncGenerator[str, None]:
        accumulated_text = ""
        assistant_parts: list[dict[str, Any]] = []

        try:
            async for event_name, payload in default_chat_stream_runner(
                message=body.message, thread_id=str(id)
            ):
                delta = _collect_stream_part(
                    event_name=event_name,
                    payload=payload,
                    assistant_parts=assistant_parts,
                )
                accumulated_text += delta
                yield format_sse(event=event_name, data=payload)

            if accumulated_text:
                assistant_parts.append({"type": "text", "text": accumulated_text})

            if assistant_parts:
                assistant_msg = {
                    "id": f"msg_{uuid.uuid4().hex[:12]}",
                    "role": "assistant",
                    "parts": assistant_parts,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                crud.append_message_to_transcript(
                    session=session,
                    db_thread=thread,
                    message=assistant_msg,
                )

        except Exception as exc:
            yield format_sse(event="error", data={"message": str(exc)})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
