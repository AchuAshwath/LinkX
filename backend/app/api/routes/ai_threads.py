import copy
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from typing import Annotated, Any, NamedTuple

import httpx
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.models import (
    AIModelInfo,
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


def _handle_draft_part(
    *, payload: dict[str, Any], assistant_parts: list[dict[str, Any]]
) -> None:
    content = str(payload.get("content", ""))
    post_id = str(payload.get("post_id", ""))
    platform = str(payload.get("platform", "x"))
    status = str(payload.get("status", "draft"))

    assistant_parts.append(
        {
            "type": "draft_artifact",
            "artifact": {
                "id": post_id,
                "postId": post_id,
                "content": content,
                "platform": platform,
                "characterCount": payload.get("char_count") or len(content),
                "status": status,
            },
            "post_id": post_id,
            "content": content,
            "platform": platform,
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
        "draft_artifact": lambda: _handle_draft_part(
            payload=payload, assistant_parts=assistant_parts
        ),
        "trending_artifact": lambda: _handle_trending_part(
            payload=payload, assistant_parts=assistant_parts
        ),
    }
    action = part_dispatch.get(event_name)
    if action:
        action()
    return ""


FRIENDLY_MODEL_NAMES: dict[str, str] = {
    "gpt-5.6-luna": "5.6 Luna",
    "gpt-5.6-sol": "5.6 Sol",
    "gpt-5.6-terra": "5.6 Terra",
    "gpt-5.4": "5.4",
    "gpt-5.4-mini": "5.4 Mini",
    "gpt-5.5": "5.5",
}

EXCLUDED_MODELS = {
    "gpt-image-2",
    "gpt-image-1.5",
    "gpt-5.3-codex-spark",
    "codex-auto-review",
}


def _build_fallback_models(default_model_id: str) -> list[AIModelInfo]:
    ids = [
        default_model_id,
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.5",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
    ]
    unique_ids = dict.fromkeys(m for m in ids if m)
    return [
        AIModelInfo(
            id=mid,
            name=FRIENDLY_MODEL_NAMES.get(mid, mid),
            provider="OpenAI",
            is_default=(mid == default_model_id),
        )
        for mid in unique_ids
    ]


def _is_allowed_proxy_model(item: dict[str, Any], default_model_id: str) -> bool:
    raw_id = item.get("id")
    if not raw_id:
        return False
    model_id = str(raw_id)
    if model_id == default_model_id:
        return True
    if model_id in EXCLUDED_MODELS:
        return False
    return str(item.get("owned_by", "")).lower() != "antigravity"


def _fetch_models_from_proxy(default_model_id: str) -> list[AIModelInfo]:
    api_key = (
        settings.OPENAI_API_COMPATIBLE_API_KEY or settings.AI_API_KEY or "dummy-key"
    )
    with httpx.Client(timeout=3.0) as client:
        resp = client.get(
            f"{settings.AI_API_BASE}/models",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if resp.status_code != 200:
            return []
        items = resp.json().get("data", [])
        return [
            AIModelInfo(
                id=str(item["id"]),
                name=FRIENDLY_MODEL_NAMES.get(str(item["id"]), str(item["id"])),
                provider=str(item.get("owned_by", "")).capitalize() or None,
                is_default=(str(item["id"]) == default_model_id),
            )
            for item in items
            if _is_allowed_proxy_model(item, default_model_id)
        ]


def _ensure_default_model(
    models: list[AIModelInfo], default_model_id: str
) -> list[AIModelInfo]:
    if any(m.id == default_model_id for m in models):
        return models
    return [
        AIModelInfo(
            id=default_model_id,
            name=FRIENDLY_MODEL_NAMES.get(default_model_id, default_model_id),
            provider="OpenAI",
            is_default=True,
        ),
        *models,
    ]


@router.get("/models", response_model=AIModelsPublic)
def list_ai_models() -> Any:
    """List available AI models from the proxy/backend with friendly labels."""
    default_model_id = settings.AI_MODEL.removeprefix("openai/")
    if default_model_id.startswith("gemini"):
        default_model_id = "gpt-5.4"
    try:
        models = _fetch_models_from_proxy(default_model_id)
        if models:
            resolved = _ensure_default_model(models, default_model_id)
            return AIModelsPublic(data=resolved, default_model=default_model_id)
    except Exception:
        pass
    fallback = _build_fallback_models(default_model_id)
    return AIModelsPublic(data=fallback, default_model=default_model_id)


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
        "parts": payload.assistant_parts,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    crud.append_message_to_transcript(
        session=session,
        db_thread=thread,
        message=assistant_msg,
    )

    if thread.message_count <= 2:
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


def _sanitize_image_urls(images: list[str] | None) -> list[str]:
    """Filter, sanitize, and convert valid image data URLs or HTTP/HTTPS image links."""
    return _clean_image_urls(images=images)


def _build_user_message_dict(
    message_text: str, clean_images: list[str]
) -> dict[str, Any]:
    """Construct transcript user message turn."""
    user_parts: list[dict[str, Any]] = []
    if message_text:
        user_parts.append({"type": "text", "text": message_text})
    for img in clean_images:
        user_parts.append({"type": "image_url", "image_url": {"url": img}})
    return {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "role": "user",
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


async def _generate_chat_events(
    *,
    ctx: ChatStreamContext,
) -> AsyncGenerator[str, None]:
    """Execute chat stream and yield formatted SSE events."""
    accumulated_text = ""
    assistant_parts: list[dict[str, Any]] = []

    target_model = ctx.body.model
    if target_model and target_model.startswith("gemini"):
        target_model = "gpt-5.4"

    transcript_copy = copy.deepcopy(ctx.thread.transcript)
    try:
        async for event_name, payload in default_chat_stream_runner(
            message=ctx.effective_prompt,
            transcript=transcript_copy,
            model=target_model,
            images=ctx.clean_images or None,
            user_id=ctx.user_id_str,
            session=ctx.session,
            thread_id=str(ctx.thread.id),
        ):
            delta = _collect_stream_part(
                event_name=event_name,
                payload=payload,
                assistant_parts=assistant_parts,
            )
            accumulated_text += delta
            _maybe_link_draft_post(
                thread=ctx.thread,
                session=ctx.session,
                event_name=event_name,
                payload=payload,
            )
            yield format_sse(event=event_name, data=payload)

        await _save_assistant_turn(
            session=ctx.session,
            thread=ctx.thread,
            payload=AssistantTurnPayload(
                body=ctx.body,
                accumulated_text=accumulated_text,
                assistant_parts=assistant_parts,
            ),
        )

    except Exception as exc:
        yield format_sse(event="error", data={"message": str(exc)})


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
    clean_images = _sanitize_image_urls(body.images)
    if not message_text and not clean_images:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Message content or at least one image is required",
        )

    user_msg = _build_user_message_dict(message_text, clean_images)
    crud.append_message_to_transcript(
        session=session, db_thread=thread, message=user_msg
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
