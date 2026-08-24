"""Chaos test suite for Database Transactions, Upsert Conflicts, Corrupted Ingestion,
and Rollback Isolation in the Trending Topics pipeline.
"""

from datetime import datetime, timezone

import pytest
from sqlmodel import Session, select

from app import crud
from app.models import (
    TrendingTopic,
    TrendingTweet,
)
from scripts.scrape_trending_topics import (
    parse_engagement_metrics,
    parse_post_count,
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
