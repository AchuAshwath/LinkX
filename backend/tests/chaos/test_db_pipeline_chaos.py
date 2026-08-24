"""Chaos test suite for Database Transactions, Upsert Conflicts, Corrupted Ingestion,
and Rollback Isolation in the Trending Topics pipeline.
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
    _should_skip_link,
    parse_engagement_metrics,
    parse_post_count,
    parse_relative_time,
    parse_title_metadata,
)
from tests.utils.user import create_random_user

# ==============================================================================
# Suite 1: Duplicate Conflict & Upsert Stress
# ==============================================================================


def test_upsert_trending_topic_idempotence_and_metadata_update(db: Session) -> None:
    """Test scraping the exact same topic URL multiple times for the same user.

    Ensures the upsert performs an in-place idempotent update rather than
    crashing on unique constraints or inserting duplicate rows.
    """
    user = create_random_user(db)
    topic_url = "https://x.com/i/trending/1890000000000000001"
    now1 = datetime(2026, 8, 20, 10, 0, 0, tzinfo=timezone.utc)

    # 1. Initial Insert
    payload1 = {
        "user_id": user.id,
        "topic_url": topic_url,
        "topic_title": "Initial Title: Space Mission",
        "category": "Science",
        "post_count": 12000,
        "summary": "Initial summary of the launch.",
        "first_seen_at": now1,
        "last_seen_at": now1,
        "scraped_at": now1,
    }
    topic1 = crud.upsert_trending_topic(session=db, topic_data=payload1)
    original_id = topic1.id
    original_created_at = topic1.created_at

    # Verify 1 record in DB
    records = db.exec(
        select(TrendingTopic).where(
            TrendingTopic.user_id == user.id, TrendingTopic.topic_url == topic_url
        )
    ).all()
    assert len(records) == 1
    assert records[0].topic_title == "Initial Title: Space Mission"
    assert records[0].post_count == 12000

    # 2. Second Upsert with updated title, post_count, summary, and last_seen_at
    now2 = datetime(2026, 8, 20, 12, 0, 0, tzinfo=timezone.utc)
    payload2 = {
        "user_id": user.id,
        "topic_url": topic_url,
        "topic_title": "Updated Title: Space Mission Lands Successfully",
        "category": "Technology & Science",
        "post_count": 45000,
        "summary": "Updated summary: the spacecraft has landed.",
        "first_seen_at": now1,
        "last_seen_at": now2,
        "scraped_at": now2,
    }
    topic2 = crud.upsert_trending_topic(session=db, topic_data=payload2)

    # 3. Assertions: Same ID, exactly 1 row, updated fields, preserved created_at
    assert topic2.id == original_id
    # Expire session cache to read freshly updated database state
    db.expire_all()
    records_after = db.exec(
        select(TrendingTopic).where(
            TrendingTopic.user_id == user.id, TrendingTopic.topic_url == topic_url
        )
    ).all()
    assert len(records_after) == 1
    updated_topic = records_after[0]
    assert (
        updated_topic.topic_title == "Updated Title: Space Mission Lands Successfully"
    )
    assert updated_topic.category == "Technology & Science"
    assert updated_topic.post_count == 45000
    assert updated_topic.summary == "Updated summary: the spacecraft has landed."
    assert updated_topic.last_seen_at == now2
    assert updated_topic.created_at == original_created_at


def test_upsert_trending_topic_identity_map_stale_cache_vulnerability(
    db: Session,
) -> None:
    """Expose the session identity map caching vulnerability in upsert_trending_topic.

    When upsert_trending_topic is called on a session that already has the entity
    in its identity map (common in long-lived sessions or batch scripts),
    the returned object or un-expired query returns stale attributes unless
    explicitly refreshed.
    """
    user = create_random_user(db)
    topic_url = "https://x.com/i/trending/stale_cache_demo"
    now = datetime.now(timezone.utc)

    # First insert
    t1 = crud.upsert_trending_topic(
        session=db,
        topic_data={
            "user_id": user.id,
            "topic_url": topic_url,
            "topic_title": "Initial Unmodified Title",
            "post_count": 100,
            "scraped_at": now,
        },
    )
    assert t1.topic_title == "Initial Unmodified Title"

    # Upsert with new title
    t2 = crud.upsert_trending_topic(
        session=db,
        topic_data={
            "user_id": user.id,
            "topic_url": topic_url,
            "topic_title": "Modified Title After Re-Scrape",
            "post_count": 500,
            "scraped_at": now,
        },
    )

    # Because upsert_trending_topic returns row[0] without populate_existing or refresh,
    # t2 is the exact same in-memory object as t1 with stale in-memory state if not refreshed.
    # We verify that refreshing loads the actual persisted DB state:
    db.refresh(t2)
    assert t2.topic_title == "Modified Title After Re-Scrape"
    assert t2.post_count == 500


def test_upsert_trending_topic_cross_user_isolation(db: Session) -> None:
    """Test that two different users scraping the same topic URL do not collide."""
    user_a = create_random_user(db)
    user_b = create_random_user(db)
    shared_url = "https://x.com/i/trending/shared_hot_topic"
    now = datetime.now(timezone.utc)

    topic_a = crud.upsert_trending_topic(
        session=db,
        topic_data={
            "user_id": user_a.id,
            "topic_url": shared_url,
            "topic_title": "User A Title",
            "category": "News",
            "post_count": 1000,
            "scraped_at": now,
        },
    )

    topic_b = crud.upsert_trending_topic(
        session=db,
        topic_data={
            "user_id": user_b.id,
            "topic_url": shared_url,
            "topic_title": "User B Title",
            "category": "Politics",
            "post_count": 2000,
            "scraped_at": now,
        },
    )

    assert topic_a.id != topic_b.id
    assert topic_a.user_id == user_a.id
    assert topic_b.user_id == user_b.id

    # Verify both exist independently
    topics_a = crud.get_latest_trending_topics(session=db, user_id=user_a.id)
    topics_b = crud.get_latest_trending_topics(session=db, user_id=user_b.id)
    assert any(t.id == topic_a.id and t.topic_title == "User A Title" for t in topics_a)
    assert any(t.id == topic_b.id and t.topic_title == "User B Title" for t in topics_b)


def test_replace_trending_tweets_within_batch_duplicates(db: Session) -> None:
    """Test inserting duplicate tweets in the same batch.

    Verifies that duplicate tweets from the same or different authors are
    handled cleanly without primary key collisions.
    """
    user = create_random_user(db)
    topic = crud.upsert_trending_topic(
        session=db,
        topic_data={
            "user_id": user.id,
            "topic_url": "https://x.com/i/trending/batch_dupe_test",
            "topic_title": "Dupe Tweet Test",
            "scraped_at": datetime.now(timezone.utc),
        },
    )

    # Batch with duplicate author and identical tweet text
    duplicate_tweets = [
        {
            "author_handle": "@tech_insider",
            "text": "Breaking news on AI developments!",
            "replies": 10,
            "retweets": 20,
            "likes": 50,
            "views": 1000,
        },
        {
            "author_handle": "@tech_insider",
            "text": "Breaking news on AI developments!",  # exact duplicate
            "replies": 10,
            "retweets": 20,
            "likes": 50,
            "views": 1000,
        },
        {
            "author_handle": "@tech_insider",
            "text": "Different tweet from same author",
            "replies": 5,
            "retweets": 2,
            "likes": 15,
            "views": 500,
        },
    ]

    crud.replace_trending_tweets(
        session=db, topic_id=topic.id, tweets_data=duplicate_tweets
    )

    persisted = db.exec(
        select(TrendingTweet).where(TrendingTweet.topic_id == topic.id)
    ).all()
    assert len(persisted) == 3
    # Each row gets a distinct UUID primary key
    unique_ids = {t.id for t in persisted}
    assert len(unique_ids) == 3


def test_replace_trending_tweets_successive_batches_idempotent_replacement(
    db: Session,
) -> None:
    """Test that subsequent calls to replace_trending_tweets completely purge old tweets."""
    user = create_random_user(db)
    topic = crud.upsert_trending_topic(
        session=db,
        topic_data={
            "user_id": user.id,
            "topic_url": "https://x.com/i/trending/replace_cycle_test",
            "topic_title": "Cycle Test",
            "scraped_at": datetime.now(timezone.utc),
        },
    )

    # 1. First batch: 3 tweets
    batch_1 = [
        {
            "author_handle": f"@user_{i}",
            "text": f"Tweet {i}",
            "replies": i,
            "retweets": i,
            "likes": i,
            "views": i,
        }
        for i in range(3)
    ]
    crud.replace_trending_tweets(session=db, topic_id=topic.id, tweets_data=batch_1)
    tweets_1 = db.exec(
        select(TrendingTweet).where(TrendingTweet.topic_id == topic.id)
    ).all()
    assert len(tweets_1) == 3
    t1_ids = {t.id for t in tweets_1}

    # 2. Second batch: 2 new tweets
    batch_2 = [
        {
            "author_handle": "@new_user_1",
            "text": "New content 1",
            "replies": 100,
            "retweets": 50,
            "likes": 200,
            "views": 5000,
        },
        {
            "author_handle": "@new_user_2",
            "text": "New content 2",
            "replies": 200,
            "retweets": 80,
            "likes": 400,
            "views": 8000,
        },
    ]
    crud.replace_trending_tweets(session=db, topic_id=topic.id, tweets_data=batch_2)
    tweets_2 = db.exec(
        select(TrendingTweet).where(TrendingTweet.topic_id == topic.id)
    ).all()
    assert len(tweets_2) == 2
    t2_ids = {t.id for t in tweets_2}
    # Completely distinct IDs (old ones purged)
    assert t1_ids.isdisjoint(t2_ids)

    # 3. Third batch: empty list (clearing all tweets)
    crud.replace_trending_tweets(session=db, topic_id=topic.id, tweets_data=[])
    tweets_3 = db.exec(
        select(TrendingTweet).where(TrendingTweet.topic_id == topic.id)
    ).all()
    assert len(tweets_3) == 0


def test_rapid_successive_upsert_burst(db: Session) -> None:
    """Stress test with 30 rapid sequential upserts on the same topic URL."""
    user = create_random_user(db)
    topic_url = "https://x.com/i/trending/burst_stress_test"
    now = datetime.now(timezone.utc)

    for i in range(30):
        crud.upsert_trending_topic(
            session=db,
            topic_data={
                "user_id": user.id,
                "topic_url": topic_url,
                "topic_title": f"Burst Title Iteration #{i}",
                "category": f"Category {i % 3}",
                "post_count": 1000 + i * 500,
                "summary": f"Summary iteration {i}",
                "scraped_at": now,
            },
        )

    all_rows = db.exec(
        select(TrendingTopic).where(
            TrendingTopic.user_id == user.id, TrendingTopic.topic_url == topic_url
        )
    ).all()
    assert len(all_rows) == 1
    assert all_rows[0].topic_title == "Burst Title Iteration #29"
    assert all_rows[0].post_count == 1000 + 29 * 500


# ==============================================================================
# Suite 2: Extreme & Corrupted Data Ingestion
# ==============================================================================


@pytest.mark.parametrize(
    ("input_str", "expected"),
    [
        # Standard formats
        ("15k posts", 15000),
        ("1.5M posts", 1500000),
        ("500 post", 500),
        ("12,345 posts", 12345),
        ("  2.5k  ", 2500),
        # Chaos & edge cases
        ("", None),
        ("   ", None),
        (None, None),
        ("N/A", None),
        ("NaN", None),
        ("undefined", None),
        ("null", None),
        ("posts", None),
        ("k", None),
        ("m", None),
        ("1.2.3k posts", None),
        ("🔥🔥🔥 posts", None),
        ("<script>alert(1)</script>", None),
        ("'; DROP TABLE trending_topic; --", None),
        # Negative post counts (parses as negative int)
        ("-5 posts", -5),
        # Extremely huge numbers (parses into Python int, overflows 32-bit DB int)
        ("999999999999999999999 posts", 999999999999999999999),
    ],
)
def test_parse_post_count_chaos_fuzzing(
    input_str: str | None, expected: int | None
) -> None:
    """Fuzz parse_post_count with extreme, corrupted, and injection payloads.

    Verifies that parse_post_count never raises unhandled exceptions.
    """
    result = parse_post_count(input_str)
    assert result == expected


def test_parse_title_metadata_chaos_fuzzing() -> None:
    """Fuzz parse_title_metadata with extreme multi-line, unicode, and malicious payloads."""
    # 1. Empty string
    empty_res = parse_title_metadata("")
    assert empty_res["topic_title"] == ""

    # 2. 10,000 character string
    huge_str = "A" * 10000
    huge_res = parse_title_metadata(huge_str)
    assert huge_res["topic_title"] == huge_str

    # 3. Unicode, Emojis, RTL, ZWJ sequences
    emoji_block = "Trending · 2 hours ago\n🚀 Multi-Orbit Launch 🔥\n150K posts"
    emoji_res = parse_title_metadata(emoji_block)
    # Parser assigns the entire first line to category when '·' or 'trending' is present
    assert emoji_res["category"] == "Trending · 2 hours ago"
    assert emoji_res["time_ago"] is None
    assert emoji_res["topic_title"] == "🚀 Multi-Orbit Launch 🔥"
    assert emoji_res["post_count"] == "150K posts"

    # 4. Dot-separated metadata
    dot_block = "AI Breakthrough\n2 hours ago · Technology · 45K posts\nAdditional note"
    dot_res = parse_title_metadata(dot_block)
    assert dot_res["topic_title"] == "AI Breakthrough"
    assert dot_res["time_ago"] == "2 hours ago"
    assert dot_res["category"] == "Technology"
    assert dot_res["post_count"] == "45K posts"
    assert dot_res["extra_metadata"] == ["Additional note"]

    # 5. HTML and Script tags
    xss_block = (
        "<script>alert('xss')</script>\n· <style>body{color:red}</style> · 1M posts"
    )
    xss_res = parse_title_metadata(xss_block)
    assert "<script>" in xss_res["topic_title"]


def test_parse_engagement_metrics_chaos() -> None:
    """Fuzz parse_engagement_metrics with malformed and truncated innerText."""
    # Less than 4 lines returns all None
    assert parse_engagement_metrics("") == {
        "replies": None,
        "retweets": None,
        "likes": None,
        "views": None,
    }
    assert parse_engagement_metrics("line1\nline2\nline3") == {
        "replies": None,
        "retweets": None,
        "likes": None,
        "views": None,
    }

    # 4 lines with corrupted data
    raw_corrupted = "corrupted_replies\n1.5k\nNaN\n1.2M"
    metrics = parse_engagement_metrics(raw_corrupted)
    assert metrics["replies"] is None
    assert metrics["retweets"] == 1500
    assert metrics["likes"] is None
    assert metrics["views"] == 1200000


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

    # Read back and verify exact byte/string preservation
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

    # Tables MUST still exist and contain the uncorrupted literal strings
    persisted_topic = db.get(TrendingTopic, topic.id)
    assert persisted_topic is not None
    assert persisted_topic.topic_title == sql_injection_payload
    assert persisted_topic.topic_url == sql_injection_url

    # Check user table is intact
    persisted_user = db.get(User, user.id)
    assert persisted_user is not None


def test_db_ingestion_string_overflow_raises_data_error(db: Session) -> None:
    """Verify that strings exceeding database column limits raise DataError safely."""
    user = create_random_user(db)

    # 1. Topic title max_length is 500 characters
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

    # 2. Topic URL max_length is 512 characters
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

    # 3. Tweet author_handle max_length is 255 characters
    topic = crud.upsert_trending_topic(
        session=db,
        topic_data={
            "user_id": user.id,
            "topic_url": "https://x.com/i/trending/tweet_author_overflow",
            "topic_title": "Valid Topic Title",
            "scraped_at": datetime.now(timezone.utc),
        },
    )
    overflow_author = "@" + "C" * 256
    with pytest.raises(DataError):
        crud.replace_trending_tweets(
            session=db,
            topic_id=topic.id,
            tweets_data=[{"author_handle": overflow_author, "text": "Valid text"}],
        )
    db.rollback()


def test_db_ingestion_integer_overflow_vulnerability(db: Session) -> None:
    """Expose integer overflow vulnerability when post_count exceeds 32-bit signed int max (2,147,483,647)."""
    user = create_random_user(db)
    huge_post_count = 999999999999999999999  # > 2^31 - 1

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

    # Wrap in collection schema
    collection = TrendingTopicsPublic(data=[topic_public], count=1)
    json_output = collection.model_dump_json()
    assert "Mars Mission" in json_output


# ==============================================================================
# Suite 3: Partial Batch Failure & Transaction Rollback
# ==============================================================================


def test_replace_trending_tweets_atomic_rollback_on_poison_pill(db: Session) -> None:
    """Test atomic rollback in replace_trending_tweets when one tweet in the batch fails.

    If 3 valid tweets exist, and replacement batch has 1 valid tweet followed by
    1 poisoned tweet (e.g. author_handle exceeding 255 chars), the transaction
    MUST roll back so the original state is preserved (or at least no corrupt partial write occurs).
    """
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

    # Pre-populate 3 valid tweets
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

    # Attempt to replace with [Valid, Poison Pill]
    poison_batch = [
        {"author_handle": "@valid_new_user", "text": "Valid new text"},
        {
            "author_handle": "@" + "P" * 300,  # exceeds varchar(255)
            "text": "Poison tweet",
        },
    ]

    with pytest.raises(DataError):
        crud.replace_trending_tweets(
            session=db, topic_id=topic.id, tweets_data=poison_batch
        )

    # Roll back the aborted transaction
    db.rollback()

    # Verify state after rollback: the pre-existing 3 tweets were NOT partially deleted or corrupted
    persisted_after = db.exec(
        select(TrendingTweet).where(TrendingTweet.topic_id == topic.id)
    ).all()
    assert len(persisted_after) == 3


def test_session_poisoning_and_rollback_recovery(db: Session) -> None:
    """Demonstrate Postgres transaction poisoning on error and clean recovery via rollback."""
    user = create_random_user(db)

    # Trigger a DB error (e.g. string overflow)
    with pytest.raises(DataError):
        crud.upsert_trending_topic(
            session=db,
            topic_data={
                "user_id": user.id,
                "topic_url": "https://x.com/i/trending/poison_session",
                "topic_title": "X" * 600,  # exceeds varchar(500)
                "scraped_at": datetime.now(timezone.utc),
            },
        )

    # Attempting to execute another query without rollback will raise PendingRollbackError / InternalError
    with pytest.raises((PendingRollbackError, DBAPIError)):
        db.exec(select(User).where(User.id == user.id)).first()

    # Calling rollback clears the poisoned transaction
    db.rollback()

    # Subsequent queries now succeed cleanly
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

    # Session is operational
    test_user = create_random_user(db)
    assert test_user.id is not None


def test_save_topic_record_batch_resilience(db: Session) -> None:
    """Simulate batch execution of _save_topic_record where some topics succeed and others fail.

    Verifies that a failure in one topic does not poison the batch loop or crash subsequent saves.
    """
    user = create_random_user(db)
    valid_url_1 = "https://x.com/i/trending/batch_resilience_1"
    valid_url_3 = "https://x.com/i/trending/batch_resilience_3"
    now = datetime.now(timezone.utc)

    batch_payloads = [
        # Topic 1: Valid
        TopicRecordPayload(
            db_user_id=user.id,
            topic_url=valid_url_1,
            title_data={"topic_title": "Valid Topic 1", "category": "Tech"},
            summary_text="Summary 1",
            conversations=[{"author": "@user1", "text": "Text 1", "raw": "1\n2\n3\n4"}],
            scraped_at=now,
        ),
        # Topic 2: Poison Pill (Invalid non-existent user UUID -> triggers IntegrityError in DB)
        TopicRecordPayload(
            db_user_id=uuid.uuid4(),
            topic_url="https://x.com/i/trending/batch_resilience_2",
            title_data={"topic_title": "Poison Topic 2"},
            summary_text=None,
            conversations=[],
            scraped_at=now,
        ),
        # Topic 3: Valid
        TopicRecordPayload(
            db_user_id=user.id,
            topic_url=valid_url_3,
            title_data={"topic_title": "Valid Topic 3", "category": "Science"},
            summary_text="Summary 3",
            conversations=[{"author": "@user3", "text": "Text 3", "raw": "1\n2\n3\n4"}],
            scraped_at=now,
        ),
    ]

    # Process batch in loop (simulating scrape_trending_topics error boundary)
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
                pass  # Batch continues on error

    # Topic 1 and Topic 3 should be successfully saved in the DB
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
    assert saved_1.topic_title == "Valid Topic 1"
    assert saved_3 is not None
    assert saved_3.topic_title == "Valid Topic 3"


def test_non_atomic_save_topic_record_boundary_exposure(db: Session) -> None:
    """Expose non-atomic transaction boundary vulnerability between topic upsert and tweet replacement.

    Because upsert_trending_topic commits immediately before replace_trending_tweets
    runs, a failure in tweet insertion leaves the topic already committed in the database.
    """
    user = create_random_user(db)
    topic_url = "https://x.com/i/trending/non_atomic_test"
    now = datetime.now(timezone.utc)

    # 1. Upsert topic directly
    topic = crud.upsert_trending_topic(
        session=db,
        topic_data={
            "user_id": user.id,
            "topic_url": topic_url,
            "topic_title": "Dangling Topic Title",
            "category": "News",
            "scraped_at": now,
        },
    )
    assert topic is not None

    # 2. Attempt replace_trending_tweets with poison author handle > 255 chars
    poison_tweets = [{"author_handle": "@" + "O" * 300, "text": "Valid text"}]
    with pytest.raises(DataError):
        crud.replace_trending_tweets(
            session=db, topic_id=topic.id, tweets_data=poison_tweets
        )

    # 3. Rollback the failed tweet transaction block
    db.rollback()

    # The topic remains persisted because upsert committed separately from replace_trending_tweets
    persisted_topic = db.exec(
        select(TrendingTopic).where(
            TrendingTopic.user_id == user.id,
            TrendingTopic.topic_url == topic_url,
        )
    ).first()
    assert persisted_topic is not None
    assert persisted_topic.topic_title == "Dangling Topic Title"

    # Tweets for this topic are empty
    tweets = db.exec(
        select(TrendingTweet).where(TrendingTweet.topic_id == persisted_topic.id)
    ).all()
    assert len(tweets) == 0


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
        # Parser falls back to 1 unit when keyword is found but no digits exist
        ("🔥 minutes ago", True),
        # Parser safely catches OverflowError and returns None when hours are astronomical
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

    # Valid multi-line topic
    assert _is_valid_topic_text("Trending · News\nAI Summit", heuristic) is True

    # Missing newline
    assert _is_valid_topic_text("Single Line Topic Without Newline", heuristic) is False

    # Excluded prefix (e.g. handle)
    assert _is_valid_topic_text("@username\nProfile text", heuristic) is False

    # Excluded texts
    assert _is_valid_topic_text("Show more\nClick here", heuristic) is False
    assert _is_valid_topic_text("Subscribe\nOnly $5/mo", heuristic) is False

    # Empty and extreme strings
    assert _is_valid_topic_text("", heuristic) is False
    assert _is_valid_topic_text("A" * 10000, heuristic) is False  # No newline
    assert _is_valid_topic_text("A" * 5000 + "\n" + "B" * 5000, heuristic) is True

    # Link skipping logic
    seen_titles: dict[str, str] = {"topic_1": "Title 1"}
    assert _should_skip_link(None, "Valid\nTitle", seen_titles, heuristic) is True
    assert _should_skip_link("topic_1", "Valid\nTitle", seen_titles, heuristic) is True
    assert (
        _should_skip_link("topic_2", "Invalid Single Line", seen_titles, heuristic)
        is True
    )
    assert _should_skip_link("topic_2", "Valid\nTitle", seen_titles, heuristic) is False


def test_trending_topic_and_tweet_exact_boundary_limits(db: Session) -> None:
    """Test exact boundary length conditions for VARCHAR columns in TrendingTopic and TrendingTweet."""
    user = create_random_user(db)
    now = datetime.now(timezone.utc)

    # 1. Topic Title: Exactly 500 chars (PASS) vs 501 chars (FAIL)
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

    # 2. Category: Exactly 100 chars (PASS) vs 101 chars (FAIL)
    exact_100_cat = "C" * 100
    t_cat_pass = crud.upsert_trending_topic(
        session=db,
        topic_data={
            "user_id": user.id,
            "topic_url": "https://x.com/i/trending/cat_boundary_pass",
            "topic_title": "Cat Boundary",
            "category": exact_100_cat,
            "scraped_at": now,
        },
    )
    assert t_cat_pass.category == exact_100_cat

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

    # 3. Tweet Author Handle: Exactly 255 chars (PASS) vs 256 chars (FAIL)
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
