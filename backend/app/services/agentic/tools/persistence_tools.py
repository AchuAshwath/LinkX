"""Database Persistence and Publishing Action Tools for LinkX Agentic Supervisor."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.models import PostCreate, PostPublic, PostUpdate
from app.services.agentic.schemas import PublishResultReport
from app.services.publishing import PublishFailure, publish_post

logger = logging.getLogger(__name__)


def save_draft_post(
    *,
    user_id: str,
    content: str,
    platform: str = "x",
    image_url: str | None = None,
    method: str = "agent",
    session: Session | None = None,
) -> PostPublic | None:
    """Persist a new post draft to PostgreSQL with method='agent'."""
    try:
        user_uuid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        logger.error(f"Invalid user_id: {user_id}")
        return None

    post_in = PostCreate(
        content=content,
        platform=platform,
        method=method,
        status="draft",
        image_url=image_url,
    )

    def _exec(s: Session) -> PostPublic:
        db_post = crud.create_post(session=s, post_in=post_in, owner_id=user_uuid)
        return PostPublic(
            id=db_post.id,
            owner_id=db_post.owner_id,
            content=db_post.content,
            image_url=db_post.image_url,
            platform=db_post.platform,
            method=db_post.method,
            status=db_post.status,
            scheduled_at=db_post.scheduled_at,
            published_at=db_post.published_at,
            likes=db_post.likes,
            reposts=db_post.reposts,
            comments=db_post.comments,
            created_at=db_post.created_at,
            updated_at=db_post.updated_at,
            external_post_id=db_post.external_post_id,
        )

    if session is not None:
        return _exec(session)
    with Session(engine) as s:
        return _exec(s)


def schedule_post_in_db(
    *,
    user_id: str,
    content: str,
    platform: str,
    scheduled_at_iso: str,
    image_url: str | None = None,
    method: str = "agent",
    session: Session | None = None,
) -> PostPublic | None:
    """Create a scheduled post in PostgreSQL with future execution time validation."""
    try:
        user_uuid = uuid.UUID(user_id)
        scheduled_dt = datetime.fromisoformat(scheduled_at_iso)
        if scheduled_dt.tzinfo is None:
            scheduled_dt = scheduled_dt.replace(tzinfo=timezone.utc)
    except Exception as e:
        logger.error(f"Invalid user_id or scheduled_at_iso: {e}")
        return None

    post_in = PostCreate(
        content=content,
        platform=platform,
        method=method,
        status="scheduled",
        scheduled_at=scheduled_dt,
        image_url=image_url,
    )

    def _exec(s: Session) -> PostPublic:
        db_post = crud.create_post(session=s, post_in=post_in, owner_id=user_uuid)
        return PostPublic(
            id=db_post.id,
            owner_id=db_post.owner_id,
            content=db_post.content,
            image_url=db_post.image_url,
            platform=db_post.platform,
            method=db_post.method,
            status=db_post.status,
            scheduled_at=db_post.scheduled_at,
            published_at=db_post.published_at,
            likes=db_post.likes,
            reposts=db_post.reposts,
            comments=db_post.comments,
            created_at=db_post.created_at,
            updated_at=db_post.updated_at,
            external_post_id=db_post.external_post_id,
        )

    if session is not None:
        return _exec(session)
    with Session(engine) as s:
        return _exec(s)


async def publish_post_live(
    *,
    post_id: str,
    user_id: str,
    session: Session | None = None,
) -> PublishResultReport:
    """Execute live publishing via unified engine (stealth browser or LinkedIn REST API)."""
    try:
        post_uuid = uuid.UUID(post_id)
        user_uuid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        return PublishResultReport(
            success=False,
            post_id=post_id,
            platform="unknown",
            error="Invalid post_id or user_id",
        )

    async def _exec(s: Session) -> PublishResultReport:
        db_post = crud.get_post(session=s, post_id=post_uuid)
        if not db_post:
            return PublishResultReport(
                success=False,
                post_id=post_id,
                platform="unknown",
                error=f"Post not found with ID {post_id}",
            )

        if db_post.owner_id != user_uuid:
            return PublishResultReport(
                success=False,
                post_id=post_id,
                platform=db_post.platform,
                error="Post ownership validation failed.",
            )

        # Execute publishing
        result = await publish_post(session=s, post=db_post)

        if isinstance(result, PublishFailure):
            return PublishResultReport(
                success=False,
                post_id=post_id,
                platform=db_post.platform,
                error=result.payload.message,
            )

        # Construct post URL
        post_url = None
        if db_post.external_post_id:
            ext_id = db_post.external_post_id
            if db_post.platform == "x" or "x:" in ext_id:
                clean_id = ext_id.split("x:")[-1] if "x:" in ext_id else ext_id
                post_url = f"https://x.com/i/status/{clean_id}"
            elif db_post.platform == "linkedin" or "linkedin:" in ext_id:
                post_url = "https://www.linkedin.com/feed/"

        return PublishResultReport(
            success=True,
            post_id=post_id,
            external_post_id=db_post.external_post_id,
            post_url=post_url,
            platform=db_post.platform,
        )

    if session is not None:
        return await _exec(session)
    with Session(engine) as s:
        return await _exec(s)


def update_post_in_db(
    *,
    post_id: str,
    user_id: str,
    content: str | None = None,
    status: str | None = None,
    session: Session | None = None,
) -> PostPublic | None:
    """Update post fields in PostgreSQL with state machine validation."""
    try:
        post_uuid = uuid.UUID(post_id)
        user_uuid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        return None

    def _exec(s: Session) -> PostPublic | None:
        db_post = crud.get_post(session=s, post_id=post_uuid)
        if not db_post or db_post.owner_id != user_uuid:
            return None

        update_dict: dict[str, Any] = {}
        if content is not None:
            update_dict["content"] = content
        if status is not None:
            update_dict["status"] = status

        post_in = PostUpdate(**update_dict)
        updated = crud.update_post(session=s, db_post=db_post, post_in=post_in)
        return PostPublic(
            id=updated.id,
            owner_id=updated.owner_id,
            content=updated.content,
            image_url=updated.image_url,
            platform=updated.platform,
            method=updated.method,
            status=updated.status,
            scheduled_at=updated.scheduled_at,
            published_at=updated.published_at,
            likes=updated.likes,
            reposts=updated.reposts,
            comments=updated.comments,
            created_at=updated.created_at,
            updated_at=updated.updated_at,
            external_post_id=updated.external_post_id,
        )

    if session is not None:
        return _exec(session)
    with Session(engine) as s:
        return _exec(s)


def delete_post_from_db(
    *,
    post_id: str,
    user_id: str,
    session: Session | None = None,
) -> bool:
    """Delete a post from PostgreSQL."""
    try:
        post_uuid = uuid.UUID(post_id)
        user_uuid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        return False

    def _exec(s: Session) -> bool:
        db_post = crud.get_post(session=s, post_id=post_uuid)
        if not db_post or db_post.owner_id != user_uuid:
            return False

        crud.delete_post(session=s, post_id=post_uuid)
        return True

    if session is not None:
        return _exec(session)
    with Session(engine) as s:
        return _exec(s)
