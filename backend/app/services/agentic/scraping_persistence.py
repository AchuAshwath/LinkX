"""Database persistence helpers for ScrapingGraph execution."""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session, select

from app import crud
from app.models import User
from app.services.agentic.tools.common import resolve_session
from scripts.scrape_trending_topics import parse_post_count

logger = logging.getLogger(__name__)


def _safe_int(val: Any, *, default: int = 0) -> int:
    """Safely convert engagement metric or count to non-negative int."""
    if val is None:
        return default
    if isinstance(val, int):
        return max(0, val)
    if isinstance(val, float):
        return max(0, int(val))
    if isinstance(val, str):
        cleaned = val.strip().replace(",", "")
        try:
            return max(0, int(cleaned))
        except (ValueError, TypeError):
            parsed = parse_post_count(val)
            return max(0, parsed if parsed is not None else default)
    return default


def _resolve_user_id(*, user_id: Any, session: Session) -> uuid.UUID:
    """Resolve a valid UUID user_id from string/UUID with fallback to first DB user."""
    if isinstance(user_id, uuid.UUID):
        return user_id
    if user_id:
        try:
            return uuid.UUID(str(user_id).strip())
        except (ValueError, TypeError):
            pass

    try:
        first_user = session.exec(select(User)).first()
        if first_user and first_user.id:
            return first_user.id
    except Exception as e:
        logger.warning(f"Failed to query fallback user from DB: {e}")

    return uuid.uuid4()


def _build_topic_upsert_payload(
    *,
    resolved_user_id: uuid.UUID,
    topic: dict[str, Any],
    summaries: dict[str, str],
    now: datetime,
) -> tuple[str | None, dict[str, Any] | None]:
    """Extract and sanitize database upsert dictionary for a trending topic."""
    url = str(topic.get("topic_url") or topic.get("url", "")).strip()
    if not url:
        return None, None

    title = str(topic.get("topic_title") or topic.get("title", "")).strip()
    summary_val = summaries.get(url) or topic.get("summary")
    post_count_val = _safe_int(topic.get("post_count"), default=0) or None

    payload = {
        "user_id": resolved_user_id,
        "topic_url": url[:512],
        "topic_title": title[:500],
        "category": (
            str(topic.get("category"))[:100]
            if topic.get("category") is not None
            else None
        ),
        "post_count": post_count_val,
        "summary": str(summary_val) if summary_val is not None else None,
        "last_seen_at": now,
        "scraped_at": now,
    }
    return url, payload


def _persist_single_topic_record(
    *,
    session: Session,
    resolved_user_id: uuid.UUID,
    topic: dict[str, Any],
    tweets_map: dict[str, list[dict[str, Any]]],
    summaries: dict[str, str],
    now: datetime,
) -> tuple[int, int]:
    """Persist a single topic and its associated tweets to the database."""
    url, topic_data = _build_topic_upsert_payload(
        resolved_user_id=resolved_user_id,
        topic=topic,
        summaries=summaries,
        now=now,
    )
    if not url or not topic_data:
        return 0, 0

    topic_record = crud.upsert_trending_topic(session=session, topic_data=topic_data)
    tweets = tweets_map.get(url, [])
    persisted_tweets = 0
    if tweets and isinstance(tweets, list):
        crud.replace_trending_tweets(
            session=session, topic_id=topic_record.id, tweets_data=tweets
        )
        persisted_tweets = len(tweets)
    return 1, persisted_tweets


def persist_scraped_batch_records(
    *,
    user_id_raw: Any,
    session_arg: Any,
    scraped_topics: list[dict[str, Any]],
    topic_tweets_map: dict[str, list[dict[str, Any]]],
    topic_summaries: dict[str, str],
) -> tuple[int, int, list[str]]:
    """Persist scraped topics and tweets into PostgreSQL via CRUD upsert."""
    persisted_topics = 0
    persisted_tweets = 0
    errors: list[str] = []

    with resolve_session(session=session_arg) as session:
        resolved_user_id = _resolve_user_id(user_id=user_id_raw, session=session)
        now = datetime.now(timezone.utc)

        for topic in scraped_topics:
            if not topic:
                continue
            try:
                t_count, tw_count = _persist_single_topic_record(
                    session=session,
                    resolved_user_id=resolved_user_id,
                    topic=topic if isinstance(topic, dict) else {},
                    tweets_map=topic_tweets_map,
                    summaries=topic_summaries,
                    now=now,
                )
                persisted_topics += t_count
                persisted_tweets += tw_count
            except Exception as topic_err:
                logger.warning(f"Error persisting topic: {topic_err}")
                errors.append(str(topic_err))
                try:
                    session.rollback()
                except Exception:
                    pass

    return persisted_topics, persisted_tweets, errors
