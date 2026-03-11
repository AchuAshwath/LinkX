"""Posts API routes with persona-scoped access and LinkedIn integration."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import Session, select

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
    SocialAccount,
    User,
)
from app.services.access import get_persona_role, has_min_role
from app.services.linkedin_posts import LinkedInPostClient, LinkedInPostError

router = APIRouter(prefix="/posts", tags=["posts"])


def _get_linkedin_account(
    *, session: Session, persona_id: uuid.UUID
) -> SocialAccount | None:
    statement = select(SocialAccount).where(
        SocialAccount.persona_id == persona_id,
        SocialAccount.platform == "linkedin",
    )
    return session.exec(statement).first()


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
    if post_in.persona_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="persona_id is required",
        )

    role = _require_persona_role(
        session=session,
        user_id=current_user.id,
        persona_id=post_in.persona_id,
    )

    if post_in.status in {"published", "scheduled"} and not has_min_role(
        role=role,
        minimum="admin",
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Members can create and edit drafts only",
        )

    post = create_post(session=session, post_in=post_in, owner_id=current_user.id)

    if post_in.status == "published" and post.persona_id is not None:
        linkedin_account = _get_linkedin_account(
            session=session, persona_id=post.persona_id
        )

        if not linkedin_account or not linkedin_account.external_user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LinkedIn account not connected for this persona",
            )

        try:
            client = LinkedInPostClient()
            external_post_id = await client.create_text_post(
                persona_id=str(post.persona_id),
                linkedin_person_id=linkedin_account.external_user_id,
                content=post_in.content,
            )

            post.external_post_id = external_post_id
            post.published_at = datetime.now(timezone.utc)
            session.add(post)
            session.commit()
            session.refresh(post)

        except LinkedInPostError as e:
            post.status = "failed"
            session.add(post)
            session.commit()
            session.refresh(post)
            logging.warning("LinkedIn publish failed: %s", e.detail)

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
    if requested_status in {"published", "scheduled"} and not has_min_role(
        role=role,
        minimum="admin",
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Members can create and edit drafts only",
        )

    is_publishing = (
        post_in.status == "published"
        and post.status != "published"
        and not post.external_post_id
    )

    post = update_post(session=session, db_post=post, post_in=post_in)

    if is_publishing and post.persona_id is not None:
        linkedin_account = _get_linkedin_account(
            session=session, persona_id=post.persona_id
        )

        if not linkedin_account or not linkedin_account.external_user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LinkedIn account not connected for this persona",
            )

        try:
            client = LinkedInPostClient()
            external_post_id = await client.create_text_post(
                persona_id=str(post.persona_id),
                linkedin_person_id=linkedin_account.external_user_id,
                content=post.content,
            )

            post.external_post_id = external_post_id
            post.published_at = datetime.now(timezone.utc)
            session.add(post)
            session.commit()
            session.refresh(post)

        except LinkedInPostError as e:
            post.status = "failed"
            session.add(post)
            session.commit()
            session.refresh(post)
            logging.warning("LinkedIn publish failed: %s", e.detail)

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
