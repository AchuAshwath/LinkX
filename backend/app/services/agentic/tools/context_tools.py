"""Database Context and State Query Tools for LinkX Agentic Supervisor."""

from __future__ import annotations

import logging
import uuid

from sqlmodel import Session, col, select

from app import crud
from app.core.db import engine
from app.core.redis import get_redis
from app.models import Post, PostPublic, TrendingTopic, TrendingTopicPublic
from app.services.agentic.schemas import AccountStatusReport, TopicDetailContext
from app.services.browser.manager import BrowserManager
from app.services.linkedin_posts import linkedin_token_redis_key

logger = logging.getLogger(__name__)


def get_latest_scraped_trends(
    *,
    user_id: str,
    limit: int = 10,
    session: Session | None = None,
) -> list[TrendingTopicPublic]:
    """Query the most recent batch of scraped trending topics from Postgres."""
    try:
        user_uuid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        logger.error(f"Invalid user_id: {user_id}")
        return []

    def _query(s: Session) -> list[TrendingTopicPublic]:
        topics = crud.get_latest_trending_topics(
            session=s, user_id=user_uuid, limit=limit
        )
        return [
            TrendingTopicPublic(
                id=t.id,
                topic_title=t.topic_title,
                category=t.category,
                post_count=t.post_count,
                topic_url=t.topic_url,
                first_seen_at=t.first_seen_at,
                last_seen_at=t.last_seen_at,
                scraped_at=t.scraped_at,
            )
            for t in topics
        ]

    if session is not None:
        return _query(session)
    with Session(engine) as s:
        return _query(s)


def get_topic_tweets_and_summary(
    *,
    topic_id: str,
    max_tweets: int = 5,
    session: Session | None = None,
) -> TopicDetailContext | None:
    """Retrieve deep topic context, Grok summary, and top tweets for a specific topic ID."""
    try:
        topic_uuid = uuid.UUID(topic_id)
    except (ValueError, TypeError):
        logger.error(f"Invalid topic_id: {topic_id}")
        return None

    def _query(s: Session) -> TopicDetailContext | None:
        topic = s.get(TrendingTopic, topic_uuid)
        if not topic:
            return None

        tweets = crud.get_trending_tweets_for_topic(
            session=s, topic_id=topic_uuid, limit=max_tweets
        )
        sample_tweets = [
            {
                "author": t.author_handle,
                "text": t.text,
                "likes": t.likes or 0,
                "retweets": t.retweets or 0,
                "replies": t.replies or 0,
                "views": t.views or 0,
            }
            for t in tweets
        ]

        return TopicDetailContext(
            topic_id=str(topic.id),
            topic_title=topic.topic_title,
            category=topic.category,
            post_count=topic.post_count,
            summary=topic.summary,
            topic_url=topic.topic_url,
            sample_tweets=sample_tweets,
        )

    if session is not None:
        return _query(session)
    with Session(engine) as s:
        return _query(s)


def get_latest_published_post(
    *,
    user_id: str,
    platform: str = "x",
    session: Session | None = None,
) -> PostPublic | None:
    """Retrieve the most recently published post from the database for verification."""
    try:
        user_uuid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        logger.error(f"Invalid user_id: {user_id}")
        return None

    def _query(s: Session) -> PostPublic | None:
        post = crud.get_latest_published_post(
            session=s, user_id=user_uuid, platform=platform
        )
        if not post:
            return None

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
        )

    if session is not None:
        return _query(session)
    with Session(engine) as s:
        return _query(s)


def get_recent_post_history(
    *,
    user_id: str,
    platform: str | None = None,
    limit: int = 5,
    status: str | None = None,
    session: Session | None = None,
) -> list[PostPublic]:
    """Retrieve recent posts history to prevent duplicate content and maintain continuity."""
    try:
        user_uuid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        logger.error(f"Invalid user_id: {user_id}")
        return []

    def _query(s: Session) -> list[PostPublic]:
        statement = select(Post).where(Post.owner_id == user_uuid)
        if platform and platform != "all":
            statement = statement.where(Post.platform == platform)
        if status:
            statement = statement.where(Post.status == status)

        statement = statement.order_by(col(Post.created_at).desc()).limit(limit)
        posts = s.exec(statement).all()

        return [
            PostPublic(
                id=p.id,
                owner_id=p.owner_id,
                content=p.content,
                image_url=p.image_url,
                platform=p.platform,
                method=p.method,
                status=p.status,
                scheduled_at=p.scheduled_at,
                published_at=p.published_at,
                likes=p.likes,
                reposts=p.reposts,
                comments=p.comments,
                created_at=p.created_at,
                updated_at=p.updated_at,
                external_post_id=p.external_post_id,
            )
            for p in posts
        ]

    if session is not None:
        return _query(session)
    with Session(engine) as s:
        return _query(s)


def get_social_account_status(
    *,
    user_id: str,
    session: Session | None = None,
) -> AccountStatusReport:
    """Check connection status and credentials health for user's X and LinkedIn accounts."""
    try:
        user_uuid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        return AccountStatusReport(user_id=user_id)

    # 1. Check X (Browser session on disk)
    manager = BrowserManager(user_id=user_id)
    x_connected = manager.session_exists("x")
    meta = manager.read_session_metadata("x") if x_connected else {}

    # 2. Check LinkedIn (Redis token & DB profile)
    linkedin_connected = False
    linkedin_email = None
    linkedin_display_name = None

    try:
        r = get_redis()
        raw_token = r.get(linkedin_token_redis_key(user_id=user_uuid))
        if raw_token:
            linkedin_connected = True
    except Exception:
        linkedin_connected = False

    def _query(s: Session) -> tuple[str | None, str | None]:
        li_account = crud.get_social_account(
            session=s, user_id=user_uuid, platform="linkedin"
        )
        if li_account:
            return li_account.email, li_account.display_name
        return None, None

    if session is not None:
        linkedin_email, linkedin_display_name = _query(session)
    else:
        with Session(engine) as s:
            linkedin_email, linkedin_display_name = _query(s)

    return AccountStatusReport(
        user_id=user_id,
        x_connected=x_connected,
        x_username=meta.get("username"),
        x_is_premium=bool(meta.get("is_premium", False)),
        x_max_characters=int(meta.get("max_character_limit", 280)),
        linkedin_connected=linkedin_connected,
        linkedin_email=linkedin_email,
        linkedin_display_name=linkedin_display_name,
    )
