"""Database Context and State Query Tools for LinkX Agentic Supervisor."""

from __future__ import annotations

import logging
import uuid

from sqlmodel import Session, col, select

from app import crud
from app.core.redis import get_redis
from app.models import Post, PostPublic, TrendingTopic, TrendingTopicPublic
from app.services.agentic.schemas import AccountStatusReport, TopicDetailContext
from app.services.agentic.tools.common import resolve_session
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

    with resolve_session(session=session) as s:
        topics = crud.get_latest_trending_topics(
            session=s, user_id=user_uuid, limit=limit
        )
        return [TrendingTopicPublic.model_validate(t) for t in topics]


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

    with resolve_session(session=session) as s:
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

    with resolve_session(session=session) as s:
        post = crud.get_latest_published_post(
            session=s, user_id=user_uuid, platform=platform
        )
        if not post:
            return None
        return PostPublic.model_validate(post)


def get_recent_post_history(
    *,
    user_id: str,
    platform: str | None = None,
    limit: int = 5,
    session: Session | None = None,
) -> list[PostPublic]:
    """Retrieve recent posts history to prevent duplicate content and maintain continuity."""
    try:
        user_uuid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        logger.error(f"Invalid user_id: {user_id}")
        return []

    with resolve_session(session=session) as s:
        statement = select(Post).where(Post.owner_id == user_uuid)
        if platform and platform != "all":
            statement = statement.where(Post.platform == platform)

        statement = statement.order_by(col(Post.created_at).desc()).limit(limit)
        posts = s.exec(statement).all()
        return [PostPublic.model_validate(p) for p in posts]


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

    with resolve_session(session=session) as s:
        li_account = crud.get_social_account(
            session=s, user_id=user_uuid, platform="linkedin"
        )
        if li_account:
            linkedin_email = li_account.email
            linkedin_display_name = li_account.display_name

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
