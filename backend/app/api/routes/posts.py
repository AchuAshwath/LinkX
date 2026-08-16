"""Posts API routes with direct user ownership and platform publishing."""

from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from PIL import Image
from sqlmodel import Session

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.crud import create_post, delete_post, get_post, get_posts, update_post
from app.models import (
    AIDraftRequest,
    AIDraftResponse,
    MediaPublic,
    Message,
    Post,
    PostAuthor,
    PostCreate,
    PostPublic,
    PostsPublic,
    PostUpdate,
    User,
)
from app.services.ai_draft import generate_ai_post_draft
from app.services.post_state_machine import validate_transition
from app.services.publishing import PublishFailure, publish_post

router = APIRouter(prefix="/posts", tags=["posts"])

ALLOWED_MEDIA_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/avif",
    "image/bmp",
}
MAX_MEDIA_SIZE = 5 * 1024 * 1024  # 5 MB


def normalize_uploaded_image(content: bytes) -> tuple[bytes, str, str]:
    """Validate and normalize raw image bytes to standard web formats.

    Returns:
        tuple[bytes, str, str]: (normalized_bytes, file_extension, content_type)
    """
    try:
        image = Image.open(io.BytesIO(content))
        if image.format == "GIF":
            return content, ".gif", "image/gif"
        if image.format == "PNG" and image.mode in ("RGBA", "LA", "P"):
            out_buf = io.BytesIO()
            image.save(out_buf, format="PNG", optimize=True)
            return out_buf.getvalue(), ".png", "image/png"

        rgb_image = image.convert("RGB") if image.mode != "RGB" else image
        out_buf = io.BytesIO()
        rgb_image.save(out_buf, format="JPEG", quality=92, optimize=True)
        return out_buf.getvalue(), ".jpg", "image/jpeg"
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid or unsupported image file: {exc}",
        ) from exc


@router.post("/media", response_model=MediaPublic)
async def upload_media(
    *,
    _current_user: CurrentUser,
    file: UploadFile = File(...),
) -> Any:
    """Upload a media file (image) for posts."""
    if not file.content_type or file.content_type.lower() not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Allowed types: JPEG, PNG, GIF, WebP, AVIF",
        )

    content = await file.read()
    if len(content) > MAX_MEDIA_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File size exceeds maximum limit of 5MB",
        )

    out_bytes, final_ext, final_content_type = normalize_uploaded_image(content)

    filename = f"{uuid.uuid4()}{final_ext}"
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    destination = settings.UPLOAD_DIR / filename
    with open(destination, "wb") as f:
        f.write(out_bytes)

    return MediaPublic(
        url=f"/static/uploads/{filename}",
        filename=filename,
        content_type=final_content_type,
        size_bytes=len(out_bytes),
    )


@router.post("/ai-draft", response_model=AIDraftResponse)
async def generate_ai_draft(
    *,
    _current_user: CurrentUser,
    draft_in: AIDraftRequest,
) -> Any:
    """Generate or enhance a post draft using AI based on prompt and platform."""
    content = await generate_ai_post_draft(
        prompt=draft_in.prompt,
        platform=draft_in.platform,
        tone=draft_in.tone,
    )
    return AIDraftResponse(content=content)


def _get_user_details(*, session: Session, user_id: uuid.UUID) -> User | None:
    return session.get(User, user_id)


def _build_post_author(*, user: User) -> PostAuthor:
    return PostAuthor(
        name=user.full_name or user.email,
        username=user.email.split("@")[0],
        avatarUrl=None,
    )


def _post_to_public(*, post: Post, author: PostAuthor | None = None) -> PostPublic:
    return PostPublic(
        id=post.id,
        owner_id=post.owner_id,
        content=post.content,
        image_url=post.image_url,
        platform=post.platform,
        method=post.method,
        status=post.status,
        scheduled_at=post.scheduled_at,
        published_at=post.published_at,
        likes=post.likes,
        reposts=post.reposts,
        comments=post.comments,
        created_at=post.created_at,
        updated_at=post.updated_at,
        external_post_id=post.external_post_id,
        publishing_started_at=post.publishing_started_at,
        retry_count=post.retry_count,
        last_retry_at=post.last_retry_at,
        next_retry_at=post.next_retry_at,
        error_code=post.error_code,
        error_message=post.error_message,
        author=author,
    )


def _serialize_post_with_author(*, session: Session, post: Post) -> PostPublic:
    user = _get_user_details(session=session, user_id=post.owner_id)
    author = _build_post_author(user=user) if user else None
    return _post_to_public(post=post, author=author)


def _raise_publish_failure(*, failure: PublishFailure) -> None:
    raise HTTPException(
        status_code=failure.status_code,
        detail=failure.payload.model_dump(),
    )


def _set_post_status(*, session: Session, post: Post, status_value: str) -> Post:
    validate_transition(current_status=post.status, target_status=status_value)
    post.status = status_value
    post.updated_at = datetime.now(timezone.utc)
    session.add(post)
    session.commit()
    session.refresh(post)
    return post


@router.get("", response_model=PostsPublic)
def read_posts(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    post_status: str | None = Query(default=None, alias="status"),
) -> Any:
    """Read all posts owned by current user."""
    posts, count = get_posts(
        session=session,
        owner_id=current_user.id,
        status=post_status,
        skip=skip,
        limit=limit,
    )

    user = _get_user_details(session=session, user_id=current_user.id)
    author = _build_post_author(user=user) if user else None

    return PostsPublic(
        data=[_post_to_public(post=post, author=author) for post in posts],
        count=count,
    )


@router.post("", response_model=PostPublic, status_code=status.HTTP_201_CREATED)
async def create_new_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_in: PostCreate,
) -> Any:
    """Create a new post for current user."""
    if post_in.status == "publishing":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use publish action to enter publishing state",
        )

    create_payload = post_in
    if post_in.status == "published":
        create_payload = post_in.model_copy(update={"status": "draft"})

    try:
        post = create_post(
            session=session,
            post_in=create_payload,
            owner_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if post_in.status == "published":
        failure = await publish_post(
            session=session,
            post=post,
        )
        if failure:
            _raise_publish_failure(failure=failure)

    return _serialize_post_with_author(session=session, post=post)


def _get_user_post_or_404(
    *, session: Session, post_id: uuid.UUID, user_id: uuid.UUID
) -> Post:
    post = get_post(session=session, post_id=post_id)
    if not post or post.owner_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    return post


@router.get("/{post_id}", response_model=PostPublic)
def read_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
) -> Any:
    """Read a specific post owned by current user."""
    post = _get_user_post_or_404(
        session=session, post_id=post_id, user_id=current_user.id
    )
    return _serialize_post_with_author(session=session, post=post)


@router.patch("/{post_id}", response_model=PostPublic)
async def update_existing_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
    post_in: PostUpdate,
) -> Any:
    """Update a post owned by current user."""
    post = _get_user_post_or_404(
        session=session, post_id=post_id, user_id=current_user.id
    )

    requested_status = post_in.status

    if requested_status == "publishing":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use publish action to enter publishing state",
        )

    update_payload = post_in.model_dump(exclude_unset=True)
    update_payload.pop("status", None)
    update_without_status = PostUpdate.model_validate(update_payload)

    try:
        post = update_post(
            session=session,
            db_post=post,
            post_in=update_without_status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if requested_status and requested_status != post.status:
        if requested_status == "published":
            failure = await publish_post(
                session=session,
                post=post,
            )
            if failure:
                _raise_publish_failure(failure=failure)
        else:
            try:
                post = _set_post_status(
                    session=session,
                    post=post,
                    status_value=requested_status,
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))

    return _serialize_post_with_author(session=session, post=post)


@router.delete("/{post_id}", response_model=Message)
def delete_existing_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
) -> Any:
    """Delete a post owned by current user."""
    _get_user_post_or_404(session=session, post_id=post_id, user_id=current_user.id)
    delete_post(session=session, post_id=post_id)
    return Message(message="Post deleted successfully")


@router.post("/{post_id}/publish", response_model=PostPublic)
async def publish_existing_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
) -> Any:
    """Publish a post immediately."""
    post = _get_user_post_or_404(
        session=session, post_id=post_id, user_id=current_user.id
    )

    try:
        failure = await publish_post(
            session=session,
            post=post,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if failure:
        _raise_publish_failure(failure=failure)

    return _serialize_post_with_author(session=session, post=post)


@router.post("/{post_id}/retry", response_model=PostPublic)
async def retry_failed_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
) -> Any:
    """Retry a failed post."""
    post = _get_user_post_or_404(
        session=session, post_id=post_id, user_id=current_user.id
    )

    if post.status != "failed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only failed posts can be retried",
        )

    try:
        validate_transition(
            current_status=post.status,
            target_status="scheduled",
            manual_retry=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    post.status = "scheduled"
    post.next_retry_at = datetime.now(timezone.utc)
    post.updated_at = datetime.now(timezone.utc)
    session.add(post)
    session.commit()
    session.refresh(post)

    failure = await publish_post(
        session=session,
        post=post,
    )
    if failure:
        _raise_publish_failure(failure=failure)

    return _serialize_post_with_author(session=session, post=post)
