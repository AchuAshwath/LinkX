"""Database loading and persistence queries for VerificationGraph."""

from __future__ import annotations

import uuid
from typing import Any

from sqlmodel import Session, col, select

from app import crud
from app.models import Post

__all__ = [
    "load_target_posts_from_db",
]


def _load_posts_by_ids(
    *, session: Session, user_uuid: uuid.UUID, post_ids: list[str]
) -> list[dict[str, Any]]:
    """Fetch target posts by explicit post ID list."""
    target_posts: list[dict[str, Any]] = []
    for pid_str in post_ids:
        try:
            p_uuid = uuid.UUID(pid_str)
            db_p = crud.get_post(session=session, post_id=p_uuid)
            if db_p and db_p.owner_id == user_uuid:
                target_posts.append(
                    {
                        "id": str(db_p.id),
                        "content": db_p.content,
                        "platform": db_p.platform,
                        "external_post_id": db_p.external_post_id,
                        "status": db_p.status,
                    }
                )
        except (ValueError, TypeError):
            continue
    return target_posts


def _load_recent_published_posts(
    *, session: Session, user_uuid: uuid.UUID, platform: str
) -> list[dict[str, Any]]:
    """Fetch recent published/failed posts for user matching platform."""
    target_posts: list[dict[str, Any]] = []
    clean_plat = platform.lower().strip()
    stmt = (
        select(Post)
        .where(Post.owner_id == user_uuid)
        .where(col(Post.status).in_(["published", "failed"]))
        .order_by(col(Post.created_at).desc())
        .limit(5)
    )
    for p in session.exec(stmt).all():
        if clean_plat in ("both", "all", "linkx") or p.platform.lower() == clean_plat:
            target_posts.append(
                {
                    "id": str(p.id),
                    "content": p.content,
                    "platform": p.platform,
                    "external_post_id": p.external_post_id,
                    "status": p.status,
                }
            )
    return target_posts


def load_target_posts_from_db(
    *,
    session: Session,
    user_uuid: uuid.UUID,
    post_ids: list[str],
    platform: str,
) -> list[dict[str, Any]]:
    """Fetch target posts from PostgreSQL by IDs or recent published state."""
    if post_ids:
        return _load_posts_by_ids(
            session=session, user_uuid=user_uuid, post_ids=post_ids
        )
    return _load_recent_published_posts(
        session=session, user_uuid=user_uuid, platform=platform
    )
