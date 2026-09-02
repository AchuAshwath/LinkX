import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from typing import Annotated, Any

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


def _collect_stream_part(
    *,
    event_name: str,
    payload: dict[str, Any],
    assistant_parts: list[dict[str, Any]],
) -> str:
    """Append structured message parts and return text delta if present."""
    if event_name == "thought":
        thought_content = str(payload.get("content", ""))
        if assistant_parts and assistant_parts[-1].get("type") == "thought":
            assistant_parts[-1]["content"] += thought_content
        else:
            assistant_parts.append({"type": "thought", "content": thought_content})
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


FRIENDLY_MODEL_NAMES: dict[str, str] = {
    "gemini-3.6-flash-high": "Gemini 3.6 Flash",
    "gemini-3.7-flash-high": "Gemini 3.7 Flash",
    "gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
    "gemini-3.1-pro-low": "Gemini 3.1 Pro",
    "gemini-3-flash": "Gemini 3 Flash",
    "claude-sonnet-4-6": "Claude 3.7 Sonnet",
    "claude-opus-4-6-thinking": "Claude 3.7 Opus",
    "gpt-5.6-luna": "GPT-5.6 Luna",
    "gpt-5.6-sol": "GPT-5.6 Sol",
    "gpt-5.6-terra": "GPT-5.6 Terra",
    "gpt-5.4": "GPT-5.4",
    "gpt-5.4-mini": "GPT-5.4 Mini",
    "gpt-5.5": "GPT-5.5",
    "gpt-oss-120b-medium": "DeepSeek R1",
}

EXCLUDED_MODELS = {
    "gpt-image-2",
    "gpt-image-1.5",
    "gemini-3.1-flash-image",
    "gpt-5.3-codex-spark",
    "codex-auto-review",
}


FALLBACK_MODEL_OPTIONS: list[tuple[str, str, str]] = [
    ("gemini-3.6-flash-high", "Gemini 3.6 Flash", "Google"),
    ("claude-sonnet-4-6", "Claude 3.7 Sonnet", "Anthropic"),
    ("gpt-5.6-luna", "GPT-5.6 Luna", "OpenAI"),
    ("gpt-5.4", "GPT-5.4", "OpenAI"),
    ("gpt-oss-120b-medium", "DeepSeek R1", "OpenSource"),
]


def _build_fallback_models(default_model_id: str) -> list[AIModelInfo]:
    return [
        AIModelInfo(
            id=mid,
            name=name,
            provider=provider,
            is_default=(mid == default_model_id),
        )
        for mid, name, provider in FALLBACK_MODEL_OPTIONS
    ]


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
            if item.get("id") and str(item["id"]) not in EXCLUDED_MODELS
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
                message=body.message,
                thread_id=str(id),
                transcript=thread.transcript,
                model=body.model,
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

                # Generate high-quality AI title on the first conversation turn
                if thread.message_count <= 2:
                    try:
                        ai_title = await generate_ai_thread_title(
                            user_prompt=body.message,
                            assistant_response=accumulated_text,
                            model=body.model,
                        )
                        if ai_title:
                            thread.title = ai_title
                            session.add(thread)
                            session.commit()
                    except Exception:
                        pass

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
