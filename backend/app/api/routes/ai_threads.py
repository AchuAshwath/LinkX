import asyncio
import logging
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from typing import Annotated, Any, NamedTuple

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.models import (
    AIModelsPublic,
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
from app.services.ai_chat_runner import (
    default_chat_stream_runner,
    format_sse,
    generate_ai_thread_title,
)
from app.services.ai_image_utils import sanitize_image_urls as _clean_image_urls
from app.services.ai_model_catalog import get_available_ai_models
from app.services.ai_turn_accumulator import (
    TranscriptEditPayload,
    append_or_update_draft_part,
    apply_transcript_branch,
    resolve_active_branch,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai/threads", tags=["ai-threads"])


class ThreadFilters(BaseModel):
    archived: bool | None = None
    skip: int = 0
    limit: int = 100


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


def _handle_thought_part(
    payload: dict[str, Any], assistant_parts: list[dict[str, Any]]
) -> None:
    thought_content = str(payload.get("content", ""))
    if assistant_parts and assistant_parts[-1].get("type") == "thought":
        assistant_parts[-1]["content"] += thought_content
    else:
        assistant_parts.append({"type": "thought", "content": thought_content})


def _is_matching_tool_part(
    *, part: dict[str, Any], tool_id: str, tool_name: str
) -> bool:
    """Check if a transcript part matches the target tool call."""
    if part.get("type") not in ("tool_call", "tool-call"):
        return False
    if part.get("toolCallId") == tool_id or part.get("name") == tool_name:
        return True
    tool_data = part.get("tool")
    return isinstance(tool_data, dict) and tool_data.get("name") == tool_name


def _update_existing_tool_part(
    *,
    assistant_parts: list[dict[str, Any]],
    tool_id: str,
    tool_name: str,
    output: Any,
) -> bool:
    """Update state and output on an existing tool part if found."""
    for part in reversed(assistant_parts):
        if _is_matching_tool_part(part=part, tool_id=tool_id, tool_name=tool_name):
            part["state"] = "completed"
            if output is not None:
                part["output"] = output
            tool_data = part.get("tool")
            if isinstance(tool_data, dict):
                tool_data["state"] = "completed"
                tool_data["output"] = output
            return True
    return False


def _handle_tool_part(
    *,
    event_name: str,
    payload: dict[str, Any],
    assistant_parts: list[dict[str, Any]],
) -> None:
    tool_id = str(payload.get("id") or f"call_{uuid.uuid4().hex[:8]}")
    tool_name = str(payload.get("name") or "tool")
    output = payload.get("output")

    if event_name == "tool_output":
        updated = _update_existing_tool_part(
            assistant_parts=assistant_parts,
            tool_id=tool_id,
            tool_name=tool_name,
            output=output,
        )
        if updated:
            return

    tool_item: dict[str, Any] = {
        "id": tool_id,
        "name": tool_name,
        "state": "running" if event_name == "tool_start" else "completed",
    }
    if "input" in payload:
        tool_item["input"] = payload["input"]
    if output is not None:
        tool_item["output"] = output

    assistant_parts.append(
        {
            "type": "tool-call",
            "toolCallId": tool_id,
            "name": tool_name,
            "state": tool_item["state"],
            "tool": tool_item,
        }
    )


def _handle_trending_part(
    *, payload: dict[str, Any], assistant_parts: list[dict[str, Any]]
) -> None:
    topics = payload.get("topics", [])
    assistant_parts.append(
        {
            "type": "trending_artifact",
            "artifact": {
                "topics": topics,
                "count": payload.get("count", len(topics)),
            },
        }
    )


def _collect_stream_part(
    *,
    event_name: str,
    payload: dict[str, Any],
    assistant_parts: list[dict[str, Any]],
) -> str:
    """Append structured message parts and return text delta if present."""
    if event_name == "text_delta":
        return str(payload.get("content", ""))

    part_dispatch = {
        "thought": lambda: _handle_thought_part(payload, assistant_parts),
        "tool_start": lambda: _handle_tool_part(
            event_name=event_name,
            payload=payload,
            assistant_parts=assistant_parts,
        ),
        "tool_output": lambda: _handle_tool_part(
            event_name=event_name,
            payload=payload,
            assistant_parts=assistant_parts,
        ),
        "draft_artifact": lambda: append_or_update_draft_part(
            assistant_parts, payload=payload
        ),
        "trending_artifact": lambda: _handle_trending_part(
            payload=payload, assistant_parts=assistant_parts
        ),
    }
    action = part_dispatch.get(event_name)
    if action:
        action()
    return ""


@router.get("/models", response_model=AIModelsPublic)
def list_ai_models() -> Any:
    """List available AI models from the proxy/backend with friendly labels."""
    configured_default = settings.AI_MODEL.removeprefix("openai/")
    return get_available_ai_models(configured_default=configured_default)


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
    filters: Annotated[ThreadFilters, Query()] = ThreadFilters(),
) -> Any:
    """List chat threads for the current user with optional archive filter."""
    threads, count = crud.get_chat_threads(
        session=session,
        owner_id=current_user.id,
        is_archived=filters.archived,
        skip=filters.skip,
        limit=filters.limit,
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


class AssistantTurnPayload(NamedTuple):
    body: ChatMessageRequest
    accumulated_text: str
    assistant_parts: list[dict[str, Any]]


async def _save_assistant_turn(
    *,
    session: Session,
    thread: ChatThread,
    payload: AssistantTurnPayload,
) -> None:
    if payload.accumulated_text:
        payload.assistant_parts.append(
            {"type": "text", "text": payload.accumulated_text}
        )
    if not payload.assistant_parts:
        return

    assistant_msg = {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "role": "assistant",
        "parent_id": thread.active_leaf_id,
        "parts": payload.assistant_parts,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    crud.append_message_to_transcript(
        session=session,
        db_thread=thread,
        message=assistant_msg,
    )

    if thread.message_count <= 2 and not getattr(thread, "is_custom_title", False):
        try:
            ai_title = await generate_ai_thread_title(
                user_prompt=payload.body.message.strip() or "Image analysis",
                assistant_response=payload.accumulated_text,
                model=payload.body.model,
            )
            if ai_title:
                thread.title = ai_title
                session.add(thread)
                session.commit()
        except Exception:
            pass


def _build_user_message_dict(
    *,
    message_text: str,
    clean_images: list[str],
    parent_id: str | None = None,
) -> dict[str, Any]:
    """Construct transcript user message turn with parent_id linkage."""
    user_parts: list[dict[str, Any]] = []
    if message_text:
        user_parts.append({"type": "text", "text": message_text})
    for img in clean_images:
        user_parts.append({"type": "image_url", "image_url": {"url": img}})
    return {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "role": "user",
        "parent_id": parent_id,
        "parts": user_parts,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _maybe_link_draft_post(
    *, thread: ChatThread, session: Session, event_name: str, payload: Any
) -> None:
    """Auto-link newly created draft post ID to chat thread."""
    if event_name != "draft_artifact" or not isinstance(payload, dict):
        return
    post_id_val = payload.get("post_id") or payload.get("postId") or payload.get("id")
    if not post_id_val:
        return
    try:
        thread.post_id = uuid.UUID(str(post_id_val))
        session.add(thread)
        session.commit()
    except Exception:
        pass


class ChatStreamContext(NamedTuple):
    thread: ChatThread
    session: Session
    body: ChatMessageRequest
    clean_images: list[str]
    user_id_str: str
    effective_prompt: str


HEARTBEAT_INTERVAL_SECONDS = 12.0


async def _cancel_pending_task(*, task: asyncio.Task[Any]) -> None:
    if task.done():
        return
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, StopAsyncIteration):
        pass


async def _fetch_anext(*, runner_iter: Any) -> Any:
    return await runner_iter.__anext__()


def _extract_completed_item(
    *,
    task: asyncio.Task[Any],
    runner_iter: Any,
) -> tuple[Any, asyncio.Task[Any] | None]:
    try:
        item = task.result()
        return item, asyncio.create_task(_fetch_anext(runner_iter=runner_iter))
    except StopAsyncIteration:
        return None, None


async def _stream_events_with_heartbeat(
    *,
    runner: AsyncGenerator[tuple[str, dict[str, Any]], None],
    heartbeat_interval: float = HEARTBEAT_INTERVAL_SECONDS,
) -> AsyncGenerator[tuple[str, dict[str, Any]] | str, None]:
    """Yield stream runner events, interleaving SSE comments (pings) during idle intervals."""
    runner_iter = runner.__aiter__()
    next_task: asyncio.Task[Any] | None = asyncio.create_task(
        _fetch_anext(runner_iter=runner_iter)
    )

    try:
        while next_task is not None:
            done, _ = await asyncio.wait({next_task}, timeout=heartbeat_interval)
            if not done:
                yield ": ping\n\n"
                continue
            item, next_task = _extract_completed_item(
                task=next_task, runner_iter=runner_iter
            )
            if item is not None:
                yield item
    finally:
        if next_task is not None:
            await _cancel_pending_task(task=next_task)


def _build_chat_runner(
    *, ctx: ChatStreamContext
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    active_path = resolve_active_branch(
        messages=ctx.thread.transcript.get("messages", []),
        active_leaf_id=ctx.thread.active_leaf_id,
    )
    transcript_copy = {
        "messages": active_path,
        "active_leaf_id": ctx.thread.active_leaf_id,
    }
    return default_chat_stream_runner(
        message=ctx.effective_prompt,
        transcript=transcript_copy,
        model=ctx.body.model,
        images=ctx.clean_images or None,
        user_id=ctx.user_id_str,
        session=ctx.session,
        thread_id=str(ctx.thread.id),
        thread=ctx.thread,
    )


def _process_stream_item(
    *,
    item: tuple[str, dict[str, Any]],
    ctx: ChatStreamContext,
    assistant_parts: list[dict[str, Any]],
) -> tuple[str, str | None]:
    event_name, payload = item
    if event_name == "done":
        return "", None
    delta = _collect_stream_part(
        event_name=event_name,
        payload=payload,
        assistant_parts=assistant_parts,
    )
    _maybe_link_draft_post(
        thread=ctx.thread,
        session=ctx.session,
        event_name=event_name,
        payload=payload,
    )
    return delta, format_sse(event=event_name, data=payload)


async def _generate_chat_events(
    *,
    ctx: ChatStreamContext,
) -> AsyncGenerator[str, None]:
    """Execute chat stream and yield formatted SSE events."""
    accumulated_text = ""
    assistant_parts: list[dict[str, Any]] = []

    runner = _build_chat_runner(ctx=ctx)
    try:
        async for item in _stream_events_with_heartbeat(runner=runner):
            if isinstance(item, str):
                yield item
                continue
            delta, sse_chunk = _process_stream_item(
                item=item,
                ctx=ctx,
                assistant_parts=assistant_parts,
            )
            accumulated_text += delta
            if sse_chunk:
                yield sse_chunk

        await _save_assistant_turn(
            session=ctx.session,
            thread=ctx.thread,
            payload=AssistantTurnPayload(
                body=ctx.body,
                accumulated_text=accumulated_text,
                assistant_parts=assistant_parts,
            ),
        )
        yield format_sse(event="done", data={})

    except (asyncio.CancelledError, GeneratorExit):
        raise
    except Exception as exc:
        yield format_sse(event="error", data={"message": str(exc)})


def _ensure_user_turn_saved(
    *,
    session: Session,
    thread: ChatThread,
    body: ChatMessageRequest,
    clean_images: list[str],
) -> None:
    msg_text = body.message.strip()
    if body.edit_message_id and apply_transcript_branch(
        session=session,
        thread=thread,
        payload=TranscriptEditPayload(
            edit_message_id=body.edit_message_id,
            message_text=msg_text,
            clean_images=clean_images,
        ),
    ):
        return

    user_msg = _build_user_message_dict(
        message_text=msg_text,
        clean_images=clean_images,
        parent_id=thread.active_leaf_id,
    )
    crud.append_message_to_transcript(
        session=session, db_thread=thread, message=user_msg
    )


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

    message_text = body.message.strip()
    clean_images = _clean_image_urls(images=body.images)
    if not message_text and not clean_images:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Message content or at least one image is required",
        )

    _ensure_user_turn_saved(
        session=session,
        thread=thread,
        body=body,
        clean_images=clean_images,
    )

    effective_prompt = message_text or "Analyze the attached image(s)"
    stream_ctx = ChatStreamContext(
        thread=thread,
        session=session,
        body=body,
        clean_images=clean_images,
        user_id_str=str(current_user.id),
        effective_prompt=effective_prompt,
    )
    events = _generate_chat_events(ctx=stream_ctx)

    return StreamingResponse(
        events,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
