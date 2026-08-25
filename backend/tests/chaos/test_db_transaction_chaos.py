"""Chaos test suite for Database Transactions, Corrupted Ingestion, and Rollback Isolation.

Covers:
- Extreme & corrupted string ingestion (emojis, HTML, SQL injection resilience, string overflow).
- Partial batch failure & transaction rollback isolation.
- Non-atomic boundary tests and column length boundary conditions.
"""

import uuid
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from sqlalchemy.exc import (
    DataError,
    DBAPIError,
    IntegrityError,
    PendingRollbackError,
    StatementError,
)
from sqlmodel import Session, select

from app import crud
from app.models import (
    TrendingTopic,
    TrendingTopicPublic,
    TrendingTopicsPublic,
    TrendingTweet,
    User,
)
from scripts.scrape_trending_topics import (
    TopicRecordPayload,
    _is_valid_topic_text,
    _save_topic_record,
    parse_relative_time,
)
from tests.utils.user import create_random_user


def test_db_ingestion_extreme_strings_emojis_and_html(db: Session) -> None:
    """Test database persistence of topics & tweets containing emojis, HTML, and rich unicode."""
    user = create_random_user(db)
    emoji_title = "🏆 Champion's Cup 2026 🚀✨ — #1 Worldwide!"
    html_summary = "<strong>Headline:</strong> <a href='https://example.com'>Link</a> & <script>alert(1)</script>"
    tweet_text = "🎉 Big milestone reached! 🌟 @elonmusk & @team 🔥 #AI 🚀"

    topic = crud.upsert_trending_topic(
        session=db,
        topic_data={
            "user_id": user.id,
            "topic_url": "https://x.com/i/trending/emoji_html_test",
            "topic_title": emoji_title,
            "category": "🏆 Sports & Tech",
            "post_count": 88888,
            "summary": html_summary,
            "scraped_at": datetime.now(timezone.utc),
        },
    )

    crud.replace_trending_tweets(
        session=db,
        topic_id=topic.id,
        tweets_data=[
            {
                "author_handle": "@champion_🏆",
                "text": tweet_text,
                "replies": 100,
                "retweets": 500,
                "likes": 2000,
                "views": 50000,
            }
        ],
    )

    persisted_topic = db.get(TrendingTopic, topic.id)
    assert persisted_topic is not None
    assert persisted_topic.topic_title == emoji_title
    assert persisted_topic.summary == html_summary

    persisted_tweets = db.exec(
        select(TrendingTweet).where(TrendingTweet.topic_id == topic.id)
    ).all()
    assert len(persisted_tweets) == 1
    assert persisted_tweets[0].author_handle == "@champion_🏆"
    assert persisted_tweets[0].text == tweet_text


def test_db_ingestion_sql_injection_resilience(db: Session) -> None:
    """Verify that SQL injection strings are safely parameterized and never executed."""
    user = create_random_user(db)
    sql_injection_payload = (
        "'; DROP TABLE trending_tweet; DROP TABLE trending_topic; --"
    )
    sql_injection_url = (
        "https://x.com/i/trending/' OR '1'='1' UNION SELECT * FROM \"user\" --"
    )

    topic = crud.upsert_trending_topic(
        session=db,
        topic_data={
            "user_id": user.id,
            "topic_url": sql_injection_url,
            "topic_title": sql_injection_payload,
            "category": "' OR 1=1 --",
            "summary": '\'); DELETE FROM "user"; --',
            "scraped_at": datetime.now(timezone.utc),
        },
    )

    crud.replace_trending_tweets(
        session=db,
        topic_id=topic.id,
        tweets_data=[
            {
                "author_handle": '\'; DROP TABLE "user"; --',
                "text": "Robert'); DROP TABLE Students;--",
                "replies": 0,
                "retweets": 0,
                "likes": 0,
                "views": 0,
            }
        ],
    )

    persisted_topic = db.get(TrendingTopic, topic.id)
    assert persisted_topic is not None
    assert persisted_topic.topic_title == sql_injection_payload
    assert persisted_topic.topic_url == sql_injection_url

    persisted_user = db.get(User, user.id)
    assert persisted_user is not None


def test_db_ingestion_string_overflow_raises_data_error(db: Session) -> None:
    """Verify that strings exceeding database column limits raise DataError safely."""
    user = create_random_user(db)

    overflow_title = "A" * 501
    with pytest.raises(DataError):
        crud.upsert_trending_topic(
            session=db,
            topic_data={
                "user_id": user.id,
                "topic_url": "https://x.com/i/trending/title_overflow",
                "topic_title": overflow_title,
                "scraped_at": datetime.now(timezone.utc),
            },
        )
    db.rollback()

    overflow_url = "https://x.com/i/trending/" + "B" * 500
    with pytest.raises(DataError):
        crud.upsert_trending_topic(
            session=db,
            topic_data={
                "user_id": user.id,
                "topic_url": overflow_url,
                "topic_title": "Valid Title",
                "scraped_at": datetime.now(timezone.utc),
            },
        )
    db.rollback()


def test_db_ingestion_integer_overflow_vulnerability(db: Session) -> None:
    """Expose integer overflow vulnerability when post_count exceeds 32-bit signed int max."""
    user = create_random_user(db)
    huge_post_count = 999999999999999999999

    with pytest.raises((DataError, DBAPIError)):
        crud.upsert_trending_topic(
            session=db,
            topic_data={
                "user_id": user.id,
                "topic_url": "https://x.com/i/trending/huge_post_count",
                "topic_title": "Viral Event with Huge Post Count",
                "post_count": huge_post_count,
                "scraped_at": datetime.now(timezone.utc),
            },
        )
    db.rollback()


def test_db_ingestion_null_bytes_rejection(db: Session) -> None:
    """Verify that null bytes (\\x00) are rejected by PostgreSQL driver/database."""
    user = create_random_user(db)
    null_byte_title = "Corrupted\x00Title"

    with pytest.raises((ValueError, DBAPIError, StatementError)):
        crud.upsert_trending_topic(
            session=db,
            topic_data={
                "user_id": user.id,
                "topic_url": "https://x.com/i/trending/null_byte_test",
                "topic_title": null_byte_title,
                "scraped_at": datetime.now(timezone.utc),
            },
        )
    db.rollback()


def test_model_public_serialization_chaos() -> None:
    """Verify Pydantic/SQLModel serialization of TrendingTopicPublic with edge-case data."""
    topic_public = TrendingTopicPublic(
        id=uuid.uuid4(),
        topic_title="Emoji & ZWJ: 👩‍🚀 Mars Mission",
        category=None,
        post_count=None,
        topic_url="https://x.com/i/trending/mars_2026",
        first_seen_at=None,
        last_seen_at=None,
        scraped_at=datetime.now(timezone.utc),
    )

    dumped = topic_public.model_dump()
    assert dumped["category"] is None
    assert dumped["post_count"] is None
    assert "Mars Mission" in dumped["topic_title"]

    collection = TrendingTopicsPublic(data=[topic_public], count=1)
    json_output = collection.model_dump_json()
    assert "Mars Mission" in json_output


def test_replace_trending_tweets_atomic_rollback_on_poison_pill(db: Session) -> None:
    """Test atomic rollback in replace_trending_tweets when one tweet in the batch fails."""
    user = create_random_user(db)
    topic = crud.upsert_trending_topic(
        session=db,
        topic_data={
            "user_id": user.id,
            "topic_url": "https://x.com/i/trending/rollback_test",
            "topic_title": "Rollback Test Topic",
            "scraped_at": datetime.now(timezone.utc),
        },
    )

    initial_tweets = [
        {"author_handle": f"@orig_{i}", "text": f"Original text {i}"} for i in range(3)
    ]
    crud.replace_trending_tweets(
        session=db, topic_id=topic.id, tweets_data=initial_tweets
    )

    persisted_initial = db.exec(
        select(TrendingTweet).where(TrendingTweet.topic_id == topic.id)
    ).all()
    assert len(persisted_initial) == 3

    poison_batch = [
        {"author_handle": "@valid_new_user", "text": "Valid new text"},
        {"author_handle": "@" + "P" * 300, "text": "Poison tweet"},
    ]

    with pytest.raises(DataError):
        crud.replace_trending_tweets(
            session=db, topic_id=topic.id, tweets_data=poison_batch
        )

    db.rollback()

    persisted_after = db.exec(
        select(TrendingTweet).where(TrendingTweet.topic_id == topic.id)
    ).all()
    assert len(persisted_after) == 3


def test_session_poisoning_and_rollback_recovery(db: Session) -> None:
    """Demonstrate Postgres transaction poisoning on error and clean recovery via rollback."""
    user = create_random_user(db)

    with pytest.raises(DataError):
        crud.upsert_trending_topic(
            session=db,
            topic_data={
                "user_id": user.id,
                "topic_url": "https://x.com/i/trending/poison_session",
                "topic_title": "X" * 600,
                "scraped_at": datetime.now(timezone.utc),
            },
        )

    with pytest.raises((PendingRollbackError, DBAPIError)):
        db.exec(select(User).where(User.id == user.id)).first()

    db.rollback()

    user_queried = db.exec(select(User).where(User.id == user.id)).first()
    assert user_queried is not None
    assert user_queried.id == user.id


def test_upsert_trending_topic_invalid_foreign_key_rollback(db: Session) -> None:
    """Test that upserting with a non-existent user_id fails with IntegrityError and can be rolled back."""
    fake_user_id = uuid.uuid4()

    with pytest.raises(IntegrityError):
        crud.upsert_trending_topic(
            session=db,
            topic_data={
                "user_id": fake_user_id,
                "topic_url": "https://x.com/i/trending/fake_user",
                "topic_title": "Topic for Nonexistent User",
                "scraped_at": datetime.now(timezone.utc),
            },
        )

    db.rollback()
    test_user = create_random_user(db)
    assert test_user.id is not None


def test_save_topic_record_batch_resilience(db: Session) -> None:
    """Simulate batch execution of _save_topic_record where some topics succeed and others fail."""
    user = create_random_user(db)
    valid_url_1 = "https://x.com/i/trending/batch_resilience_1"
    valid_url_3 = "https://x.com/i/trending/batch_resilience_3"
    now = datetime.now(timezone.utc)

    batch_payloads = [
        TopicRecordPayload(
            db_user_id=user.id,
            topic_url=valid_url_1,
            title_data={"topic_title": "Valid Topic 1", "category": "Tech"},
            summary_text="Summary 1",
            conversations=[{"author": "@user1", "text": "Text 1", "raw": "1\n2\n3\n4"}],
            scraped_at=now,
        ),
        TopicRecordPayload(
            db_user_id=uuid.uuid4(),
            topic_url="https://x.com/i/trending/batch_resilience_2",
            title_data={"topic_title": "Poison Topic 2"},
            summary_text=None,
            conversations=[],
            scraped_at=now,
        ),
        TopicRecordPayload(
            db_user_id=user.id,
            topic_url=valid_url_3,
            title_data={"topic_title": "Valid Topic 3", "category": "Science"},
            summary_text="Summary 3",
            conversations=[{"author": "@user3", "text": "Text 3", "raw": "1\n2\n3\n4"}],
            scraped_at=now,
        ),
    ]

    def test_session_factory(*_args, **_kwargs):
        return Session(
            bind=db.get_bind(),
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )

    with patch(
        "scripts.scrape_trending_topics.Session", side_effect=test_session_factory
    ):
        for payload in batch_payloads:
            try:
                _save_topic_record(payload)
            except Exception:
                pass

    saved_1 = db.exec(
        select(TrendingTopic).where(
            TrendingTopic.user_id == user.id,
            TrendingTopic.topic_url == valid_url_1,
        )
    ).first()
    saved_3 = db.exec(
        select(TrendingTopic).where(
            TrendingTopic.user_id == user.id,
            TrendingTopic.topic_url == valid_url_3,
        )
    ).first()

    assert saved_1 is not None
    assert saved_3 is not None


@pytest.mark.parametrize(
    ("input_str", "has_result"),
    [
        ("2 hours ago", True),
        ("45 minutes ago", True),
        ("3 days ago", True),
        ("yesterday", True),
        ("Yesterday", True),
        (None, False),
        ("", False),
        ("   ", False),
        ("invalid format", False),
        ("🔥 minutes ago", True),
        ("1000000000 hours ago", False),
        ("<script>alert(1)</script>", False),
    ],
)
def test_parse_relative_time_chaos_fuzzing(
    input_str: str | None, has_result: bool
) -> None:
    """Fuzz parse_relative_time with malformed, extreme, and empty strings."""
    base_time = datetime(2026, 8, 20, 12, 0, 0, tzinfo=timezone.utc)
    result = parse_relative_time(input_str, base_time)
    if has_result:
        assert isinstance(result, datetime)
    else:
        assert result is None


def test_sidebar_heuristics_and_filtering_chaos() -> None:
    """Fuzz heuristic link filtering functions against extreme and malformed inputs."""
    heuristic = {
        "must_contain_newline": True,
        "exclude_prefix": "@",
        "exclude_texts": ["Show more", "Subscribe"],
    }

    assert _is_valid_topic_text("Trending · News\nAI Summit", heuristic) is True
    assert _is_valid_topic_text("Single Line Topic Without Newline", heuristic) is False
    assert _is_valid_topic_text("@username\nProfile text", heuristic) is False
    assert _is_valid_topic_text("Show more\nClick here", heuristic) is False
    assert _is_valid_topic_text("Subscribe\nOnly $5/mo", heuristic) is False


def test_trending_topic_and_tweet_exact_boundary_limits(db: Session) -> None:
    """Test exact boundary length conditions for VARCHAR columns in TrendingTopic and TrendingTweet."""
    user = create_random_user(db)
    now = datetime.now(timezone.utc)

    exact_500_title = "T" * 500
    t_pass = crud.upsert_trending_topic(
        session=db,
        topic_data={
            "user_id": user.id,
            "topic_url": "https://x.com/i/trending/title_boundary_pass",
            "topic_title": exact_500_title,
            "scraped_at": now,
        },
    )
    assert t_pass.topic_title == exact_500_title

    overflow_101_cat = "C" * 101
    with pytest.raises(DataError):
        crud.upsert_trending_topic(
            session=db,
            topic_data={
                "user_id": user.id,
                "topic_url": "https://x.com/i/trending/cat_boundary_fail",
                "topic_title": "Cat Fail",
                "category": overflow_101_cat,
                "scraped_at": now,
            },
        )
    db.rollback()

    exact_255_author = "@" + "A" * 254
    crud.replace_trending_tweets(
        session=db,
        topic_id=t_pass.id,
        tweets_data=[{"author_handle": exact_255_author, "text": "Boundary text"}],
    )
    tweets = db.exec(
        select(TrendingTweet).where(TrendingTweet.topic_id == t_pass.id)
    ).all()
    assert len(tweets) == 1
    assert tweets[0].author_handle == exact_255_author
