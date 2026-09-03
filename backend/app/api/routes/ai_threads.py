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


def _handle_tool_part(
    event_name: str,
    payload: dict[str, Any],
    assistant_parts: list[dict[str, Any]],
) -> None:
    part: dict[str, Any] = {
        "type": "tool_call",
        "name": payload.get("name"),
        "state": "running" if event_name == "tool_start" else "completed",
    }
    if "input" in payload:
        part["input"] = payload["input"]
    if "output" in payload:
        part["output"] = payload["output"]
    assistant_parts.append(part)


def _handle_draft_part(
    payload: dict[str, Any], assistant_parts: list[dict[str, Any]]
) -> None:
    assistant_parts.append(
        {
            "type": "draft_artifact",
            "post_id": payload.get("post_id"),
            "content": payload.get("content"),
            "platform": payload.get("platform"),
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
    if event_name == "thought":
        _handle_thought_part(payload, assistant_parts)
    elif event_name in {"tool_start", "tool_output"}:
        _handle_tool_part(event_name, payload, assistant_parts)
    elif event_name == "draft_artifact":
        _handle_draft_part(payload, assistant_parts)
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
    known_candidates: list[tuple[str, str, str]] = [
        (
            default_model_id,
            FRIENDLY_MODEL_NAMES.get(default_model_id, default_model_id),
            "OpenAI",
        ),
        ("gpt-5.4", "5.4", "OpenAI"),
        ("gpt-5.4-mini", "5.4 Mini", "OpenAI"),
        ("gpt-5.5", "5.5", "OpenAI"),
        ("gpt-5.6-sol", "5.6 Sol", "OpenAI"),
        ("gpt-5.6-terra", "5.6 Terra", "OpenAI"),
    ]
    seen: set[str] = set()
    result: list[AIModelInfo] = []
    for mid, name, provider in known_candidates:
        if mid and mid not in seen:
            seen.add(mid)
            result.append(
                AIModelInfo(
                    id=mid,
                    name=name,
                    provider=provider,
                    is_default=(mid == default_model_id),
                )
            )
    return result


def _is_allowed_proxy_model(item: dict[str, Any]) -> bool:
    raw_id = item.get("id")
    if not raw_id:
        return False
    model_id = str(raw_id)
    if model_id in EXCLUDED_MODELS:
        return False
    if model_id.lower().startswith("gemini"):
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
            if _is_allowed_proxy_model(item)
        ]


@router.get("/models", response_model=AIModelsPublic)
def list_ai_models() -> Any:
    """List available AI models from the proxy/backend with friendly labels."""
    default_model_id = settings.AI_MODEL.removeprefix("openai/")
    try:
        models = _fetch_models_from_proxy(default_model_id)
        if models:
            return AIModelsPublic(data=models, default_model=default_model_id)
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


VALID_IMAGE_SCHEMES = ("data:image/", "http://", "https://")


def _is_valid_image_url(url: Any) -> bool:
    if not isinstance(url, str):
        return False
    trimmed = url.strip()
    return any(trimmed.startswith(scheme) for scheme in VALID_IMAGE_SCHEMES)


def _sanitize_image_urls(images: list[str] | None) -> list[str]:
    """Filter and sanitize valid image data URLs or HTTP/HTTPS image links."""
    if not images:
        return []
    return [img.strip() for img in images if _is_valid_image_url(img)]


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

    async def event_generator() -> AsyncGenerator[str, None]:
        accumulated_text = ""
        assistant_parts: list[dict[str, Any]] = []

        try:
            async for event_name, payload in default_chat_stream_runner(
                message=effective_prompt,
                transcript=thread.transcript,
                model=body.model,
                images=clean_images or None,
            ):
                delta = _collect_stream_part(
                    event_name=event_name,
                    payload=payload,
                    assistant_parts=assistant_parts,
                )
                accumulated_text += delta
                yield format_sse(event=event_name, data=payload)

            await _save_assistant_turn(
                session=session,
                thread=thread,
                payload=AssistantTurnPayload(
                    body=body,
                    accumulated_text=accumulated_text,
                    assistant_parts=assistant_parts,
                ),
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
