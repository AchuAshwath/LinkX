"""Posts API routes with persona-scoped access and LinkedIn integration."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import Session

from app.api.deps import CurrentUser, SessionDep
from app.crud import create_post, delete_post, get_post, get_posts, update_post
from app.models import (
    Message,
    Post,
    PostAuthor,
    PostCreate,
    PostPublic,
    PostsPublic,
    PostUpdate,
    User,
)
from app.services.access import get_persona_role, has_min_role
from app.services.post_state_machine import validate_transition
from app.services.publishing import PublishFailure, publish_post

router = APIRouter(prefix="/posts", tags=["posts"])


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
        persona_id=post.persona_id,
        content=post.content,
        image_url=post.image_url,
        platform=post.platform,
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


def _require_persona_role(
    *,
    session: Session,
    user_id: uuid.UUID,
    persona_id: uuid.UUID,
) -> str:
    role = get_persona_role(
        session=session,
        persona_id=persona_id,
        user_id=user_id,
    )
    if not role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
    return role


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
    session: SessionDep,
    current_user: CurrentUser,
    persona_id: uuid.UUID | None = Query(default=None),
    skip: int = 0,
    limit: int = 100,
    post_status: str | None = Query(default=None, alias="status"),
) -> Any:
    if persona_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="persona_id is required",
        )

    _require_persona_role(
        session=session,
        user_id=current_user.id,
        persona_id=persona_id,
    )

    posts, count = get_posts(
        session=session,
        persona_id=persona_id,
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
    role = _require_persona_role(
        session=session,
        user_id=current_user.id,
        persona_id=post_in.persona_id,
    )

    if post_in.status == "publishing":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use publish action to enter publishing state",
        )

    if post_in.status != "draft" and not has_min_role(
        role=role,
        minimum="admin",
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Members can create and edit drafts only",
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
            user_id=current_user.id,
        )
        if failure:
            _raise_publish_failure(failure=failure)

    user = _get_user_details(session=session, user_id=current_user.id)
    author = _build_post_author(user=user) if user else None

    return _post_to_public(post=post, author=author)


@router.get("/{post_id}", response_model=PostPublic)
def read_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
) -> Any:
    post = get_post(session=session, post_id=post_id)

    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )

    if post.persona_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )

    _require_persona_role(
        session=session,
        user_id=current_user.id,
        persona_id=post.persona_id,
    )

    user = _get_user_details(session=session, user_id=post.owner_id)
    author = _build_post_author(user=user) if user else None

    return _post_to_public(post=post, author=author)


@router.patch("/{post_id}", response_model=PostPublic)
async def update_existing_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
    post_in: PostUpdate,
) -> Any:
    post = get_post(session=session, post_id=post_id)

    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )

    if post.persona_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )

    role = _require_persona_role(
        session=session,
        user_id=current_user.id,
        persona_id=post.persona_id,
    )

    requested_status = post_in.status
    if (
        requested_status
        and requested_status != "draft"
        and not has_min_role(
            role=role,
            minimum="admin",
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Members can create and edit drafts only",
        )

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
                user_id=current_user.id,
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

    user = _get_user_details(session=session, user_id=post.owner_id)
    author = _build_post_author(user=user) if user else None

    return _post_to_public(post=post, author=author)


@router.delete("/{post_id}", response_model=Message)
def delete_existing_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
) -> Any:
    post = get_post(session=session, post_id=post_id)

    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )

    if post.persona_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )

    role = _require_persona_role(
        session=session,
        user_id=current_user.id,
        persona_id=post.persona_id,
    )
    if not has_min_role(role=role, minimum="admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Members can create and edit drafts only",
        )

    delete_post(session=session, post_id=post_id)
    return Message(message="Post deleted successfully")


@router.post("/{post_id}/publish", response_model=PostPublic)
async def publish_existing_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
) -> Any:
    post = get_post(session=session, post_id=post_id)
    if not post or post.persona_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post not found",
        )

    role = _require_persona_role(
        session=session,
        user_id=current_user.id,
        persona_id=post.persona_id,
    )
    if not has_min_role(role=role, minimum="admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Members can create and edit drafts only",
        )

    try:
        failure = await publish_post(
            session=session,
            post=post,
            user_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if failure:
        _raise_publish_failure(failure=failure)

    user = _get_user_details(session=session, user_id=post.owner_id)
    author = _build_post_author(user=user) if user else None
    return _post_to_public(post=post, author=author)


@router.post("/{post_id}/retry", response_model=PostPublic)
async def retry_failed_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
) -> Any:
    post = get_post(session=session, post_id=post_id)
    if not post or post.persona_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post not found",
        )

    role = _require_persona_role(
        session=session,
        user_id=current_user.id,
        persona_id=post.persona_id,
    )
    if not has_min_role(role=role, minimum="admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Members cannot retry posts",
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
        user_id=current_user.id,
    )
    if failure:
        _raise_publish_failure(failure=failure)

    user = _get_user_details(session=session, user_id=post.owner_id)
    author = _build_post_author(user=user) if user else None
    return _post_to_public(post=post, author=author)
