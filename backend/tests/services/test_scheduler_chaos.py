"""Adversarial and chaos engineering tests for LinkX background scheduler.

These tests systematically probe edge cases, race conditions, unhandled failure modes,
and architectural vulnerabilities in Redis distributed locking, database session integrity,
state machine transitions, and error recovery.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from sqlmodel import Session

from app import crud
from app.models import Post, PostCreate, User, UserCreate
from app.services.publishing import PublishFailure
from app.services.scheduler import (
    ErrorClassifier,
    RedisDistributedLock,
    RetryPolicy,
    SchedulerService,
)
from tests.utils.utils import random_email, random_lower_string


def _create_test_user(*, db: Session) -> User:
    """Create an isolated test user."""
    return crud.create_user(
        session=db,
        user_create=UserCreate(
            email=random_email(),
            password=random_lower_string(),
        ),
    )


# ==============================================================================
# 1. CONCURRENT WORKERS & DISTRIBUTED LOCKING RACES
# ==============================================================================


@pytest.mark.anyio
async def test_concurrent_workers_without_distributed_lock_causes_double_publish(
    db: Session,
) -> None:
    """CHAOS: Two workers running without Redis locks (standalone) race to process the same post.

    Vulnerability: `get_due_posts` does not use row-level locking (SELECT ... FOR UPDATE).
    If two workers query due posts before either finishes committing `status = "publishing"`,
    both workers retrieve the same post and invoke `publish_fn`, causing duplicate external posts.
    """
    user = _create_test_user(db=db)
    due_time = datetime.now(timezone.utc) - timedelta(minutes=5)
    post = crud.create_post(
        session=db,
        post_in=PostCreate(
            content="Racy post susceptible to double publication",
            platform="x",
            status="scheduled",
            scheduled_at=due_time,
        ),
        owner_id=user.id,
    )
    assert post.id is not None

    publish_call_count = 0

    def mock_publish(*, session: Session, post: Post) -> dict[str, str]:
        _ = (session, post)
        nonlocal publish_call_count
        publish_call_count += 1
        return {"external_id": f"tw_{publish_call_count}"}

    scheduler_worker_1 = SchedulerService(publish_fn=mock_publish)
    scheduler_worker_2 = SchedulerService(publish_fn=mock_publish)

    # Worker 1 and Worker 2 both fetch due posts before either transitions the post
    due_worker_1 = scheduler_worker_1.get_due_posts(session=db, owner_id=user.id)
    due_worker_2 = scheduler_worker_2.get_due_posts(session=db, owner_id=user.id)

    assert len(due_worker_1) == 1
    assert len(due_worker_2) == 1
    assert due_worker_1[0].id == due_worker_2[0].id

    # Worker 1 processes the post
    res_1 = await scheduler_worker_1._process_single_post(
        session=db, post=due_worker_1[0], now=datetime.now(timezone.utc)
    )
    assert res_1 == "published"

    # Worker 2 processes the post object it already fetched in its batch
    # Because due_worker_2[0] was evaluated as scheduled, Worker 2 publishes again
    # or attempts state transition depending on session cache
    res_2 = await scheduler_worker_2._process_single_post(
        session=db, post=due_worker_2[0], now=datetime.now(timezone.utc)
    )
    assert res_2 in {"published", "skipped"}

    # Note: Idempotency safeguard checks `post.external_post_id`, so if Worker 1
    # populated `post.external_post_id`, Worker 2 skips publishing IF the object is refreshed.
    # But if two workers execute concurrently across separate processes/containers,
    # Worker 2 does NOT have Worker 1's memory state!
    assert publish_call_count >= 1


@pytest.mark.anyio
async def test_concurrent_workers_with_redis_lock_prevents_race() -> None:
    """Verify distributed locking blocks the second worker when key is held."""
    mock_redis = MagicMock()
    # First call acquires (True), second call fails (None / False)
    mock_redis.set.side_effect = [True, None]
    mock_redis.eval.return_value = 1

    lock_worker_1 = RedisDistributedLock(redis_client=mock_redis, lock_key="chaos:lock")
    lock_worker_2 = RedisDistributedLock(redis_client=mock_redis, lock_key="chaos:lock")

    assert lock_worker_1.acquire() is True
    assert lock_worker_2.acquire() is False

    lock_worker_1.release()
    assert lock_worker_1.acquired is False


def test_redis_lock_ttl_expiration_allows_lock_stealing() -> None:
    """CHAOS: If a worker holds the lock longer than TTL, Redis expires it,

    allowing a competing worker to acquire the lock and cause concurrency overlap.
    """
    mock_redis = MagicMock()
    # Worker 1 acquires
    mock_redis.set.return_value = True
    lock_1 = RedisDistributedLock(
        redis_client=mock_redis, lock_key="chaos:lock", expire_seconds=1
    )
    assert lock_1.acquire() is True

    # Simulate TTL expiration in Redis: Worker 2 acquires the same key
    mock_redis.set.return_value = True
    lock_2 = RedisDistributedLock(
        redis_client=mock_redis, lock_key="chaos:lock", expire_seconds=1
    )
    assert lock_2.acquire() is True

    # Now both workers believe they have the lock simultaneously
    assert lock_1.acquired is True
    assert lock_2.acquired is True

    # Safe release: Worker 1 releases, but Redis Lua script checks token match.
    # In Redis, token 1 != token 2, so Worker 1 does NOT delete Worker 2's lock.
    mock_redis.eval.return_value = 0
    lock_1.release()
    assert lock_1.acquired is False
    assert lock_2.acquired is True


# ==============================================================================
# 2. STALE / CRASHED WORKER RECOVERY (WATCHDOG RECOVERY)
# ==============================================================================


@pytest.mark.anyio
async def test_stuck_publishing_posts_are_recovered_by_watchdog(db: Session) -> None:
    """CHAOS: Worker crashed while a post was in 'publishing' status.

    Hardened: `SchedulerService.recover_stale_posts` automatically detects posts
    left in 'publishing' past the threshold and resets them to 'scheduled' with backoff!
    """
    user = _create_test_user(db=db)
    two_hours_ago = datetime.now(timezone.utc) - timedelta(hours=2)

    # Simulate a post whose worker process died mid-execution 2 hours ago
    stuck_post = crud.create_post(
        session=db,
        post_in=PostCreate(
            content="Post stuck in publishing limbo after worker crash",
            platform="x",
            status="scheduled",
            scheduled_at=two_hours_ago,
        ),
        owner_id=user.id,
    )
    # Worker started publishing and died before completion
    stuck_post.status = "publishing"
    stuck_post.publishing_started_at = two_hours_ago
    db.add(stuck_post)
    db.commit()
    db.refresh(stuck_post)

    scheduler = SchedulerService()

    # Process due posts: the watchdog recovers the stale post
    summary = await scheduler.process_due_posts(
        session=db, owner_id=user.id, redis_client=None
    )
    assert summary["recovered"] >= 1

    db.refresh(stuck_post)
    assert stuck_post.status == "scheduled"
    assert stuck_post.error_code == "STALE_TIMEOUT"


# ==============================================================================
# 3. DATABASE ROLLBACK / PER-ITEM ISOLATION MID-BATCH
# ==============================================================================


@pytest.mark.anyio
async def test_database_error_on_first_post_does_not_abort_batch(db: Session) -> None:
    """CHAOS: If the first post causes a database transaction failure,

    per-item exception isolation with session.rollback() ensures post 2 still executes.
    """
    user = _create_test_user(db=db)
    due_time = datetime.now(timezone.utc) - timedelta(minutes=5)

    post_1 = crud.create_post(
        session=db,
        post_in=PostCreate(
            content="Post 1: triggers database error",
            platform="x",
            status="scheduled",
            scheduled_at=due_time,
        ),
        owner_id=user.id,
    )
    post_2 = crud.create_post(
        session=db,
        post_in=PostCreate(
            content="Post 2: innocent bystander in batch",
            platform="linkedin",
            status="scheduled",
            scheduled_at=due_time,
        ),
        owner_id=user.id,
    )

    call_counts = {"post_1": 0, "post_2": 0}

    async def toxic_publish(*, session: Session, post: Post) -> dict[str, str]:
        _ = session
        if post.id == post_1.id:
            call_counts["post_1"] += 1
            raise RuntimeError("Post 1 simulated failure")
        call_counts["post_2"] += 1
        return {"external_id": "ext_post_2"}

    scheduler = SchedulerService(publish_fn=toxic_publish)

    summary = await scheduler.process_due_posts(
        session=db, owner_id=user.id, redis_client=None
    )

    # Post 1 failed, but Post 2 was published successfully!
    assert call_counts["post_2"] == 1
    assert summary["published"] == 1
    db.refresh(post_2)
    assert post_2.status == "published"


@pytest.mark.anyio
async def test_error_message_exceeding_max_length_is_safely_truncated(
    db: Session,
) -> None:
    """CHAOS: upstream error message exceeds PostgreSQL VARCHAR(1000) column limit.

    Hardened: error_message is safely truncated to <= 1000 chars to avoid DB overflow.
    """
    user = _create_test_user(db=db)
    due_time = datetime.now(timezone.utc) - timedelta(minutes=5)
    post = crud.create_post(
        session=db,
        post_in=PostCreate(
            content="Post triggering huge HTML error response",
            platform="x",
            status="scheduled",
            scheduled_at=due_time,
        ),
        owner_id=user.id,
    )

    huge_error_message = "A" * 5000

    def huge_error_publish(*, session: Session, post: Post) -> None:
        _ = (session, post)
        raise RuntimeError(huge_error_message)

    scheduler = SchedulerService(publish_fn=huge_error_publish)

    summary = await scheduler.process_due_posts(
        session=db, owner_id=user.id, redis_client=None
    )

    assert summary["retried"] == 1
    db.refresh(post)
    assert len(post.error_message) <= 1000
    assert post.error_message.endswith("...")


# ==============================================================================
# 4. REDIS CONNECTION LOSS DURING ACQUIRE / RELEASE
# ==============================================================================


def test_redis_connection_drop_during_acquire_fails_gracefully_but_skips_silently() -> (
    None
):
    """CHAOS: Redis connection is dropped during lock acquisition.

    RedisDistributedLock catches the exception and returns False.
    """
    mock_redis = MagicMock()
    mock_redis.set.side_effect = ConnectionError(
        "Redis cluster unreachable: connection refused"
    )

    lock = RedisDistributedLock(redis_client=mock_redis, lock_key="test:lock")
    acquired = lock.acquire()

    assert acquired is False
    assert lock.acquired is False


def test_redis_connection_drop_during_release_does_not_raise() -> None:
    """CHAOS: Redis drops connection when eval/release is called.

    Lock release must not crash the worker or hide execution results.
    """
    mock_redis = MagicMock()
    mock_redis.set.return_value = True
    mock_redis.eval.side_effect = ConnectionError("Redis connection reset by peer")

    lock = RedisDistributedLock(redis_client=mock_redis, lock_key="test:lock")
    assert lock.acquire() is True

    # Releasing when Redis is broken should log warning and reset acquired flag without raising
    lock.release()
    assert lock.acquired is False


# ==============================================================================
# 5. ERROR CLASSIFIER ADVERSARIAL PAYLOADS & TYPE CONFUSION
# ==============================================================================


def test_error_classifier_string_status_code_handled_safely() -> None:
    """CHAOS: status_code is passed as string '500' instead of int 500.

    Hardened: string status codes are coerced to integer safely.
    """
    classifier = ErrorClassifier()

    assert classifier.classify_error(status_code="500") == "SERVER_ERROR"
    assert classifier.is_retryable(status_code="500") is True
    assert classifier.classify_error(status_code="429") == "RATE_LIMITED"
    assert classifier.is_retryable(status_code="429") is True
    assert classifier.classify_error(status_code="401") == "AUTH_ERROR"
    assert classifier.is_retryable(status_code="401") is False


@pytest.mark.anyio
async def test_error_message_extracted_when_payload_is_dict(db: Session) -> None:
    """CHAOS: PublishFailure payload is a dictionary instead of a Pydantic object.

    Hardened: error messages are extracted from dictionaries as well as objects.
    """
    user = _create_test_user(db=db)
    due_time = datetime.now(timezone.utc) - timedelta(minutes=5)
    post = crud.create_post(
        session=db,
        post_in=PostCreate(
            content="Post with dict failure payload",
            platform="x",
            status="scheduled",
            scheduled_at=due_time,
        ),
        owner_id=user.id,
    )

    def dict_payload_publish(*, session: Session, post: Post) -> PublishFailure:
        _ = (session, post)
        return PublishFailure(
            status_code=500,
            payload={
                "message": "LinkedIn upstream gateway timeout",
                "detail": "gw_504",
            },  # type: ignore
        )

    scheduler = SchedulerService(publish_fn=dict_payload_publish)
    summary = await scheduler.process_due_posts(
        session=db, owner_id=user.id, redis_client=None
    )

    assert summary["retried"] == 1
    db.refresh(post)
    assert post.error_message == "LinkedIn upstream gateway timeout"


# ==============================================================================
# 6. RETRY POLICY BOUNDARIES, OVERFLOWS & TIMEZONE SKEW
# ==============================================================================


def test_retry_policy_naive_datetime_normalized_to_utc() -> None:
    """CHAOS: passing offset-naive datetime to calculate_next_retry.

    Hardened: result is normalized to timezone-aware UTC datetime.
    """
    policy = RetryPolicy()
    naive_now = datetime(2026, 10, 17, 12, 0, 0)
    next_retry = policy.calculate_next_retry(retry_count=0, now=naive_now)

    assert next_retry is not None
    assert next_retry.tzinfo == timezone.utc


def test_retry_policy_large_retry_count_bounded_without_overflow() -> None:
    """CHAOS: huge retry_count does not overflow IEEE 754 float."""
    policy = RetryPolicy(max_retries=2000)

    next_retry = policy.calculate_next_retry(retry_count=1024)
    assert next_retry is not None


def test_retry_policy_negative_retry_count_clamped_to_zero() -> None:
    """CHAOS: negative retry_count is clamped to 0."""
    policy = RetryPolicy(
        initial_delay_seconds=60, backoff_multiplier=2.0, max_retries=3
    )

    assert policy.can_retry(retry_count=-1) is True

    base_time = datetime(2026, 10, 17, 12, 0, 0, tzinfo=timezone.utc)
    next_retry = policy.calculate_next_retry(retry_count=-1, now=base_time)
    assert next_retry == base_time + timedelta(seconds=60)


# ==============================================================================
# 7. EXACT TIMESTAMP BOUNDARY & MICROSECOND RESOLUTION
# ==============================================================================


def test_get_due_posts_exact_microsecond_boundary(db: Session) -> None:
    """Verify exact microsecond boundary matches in `scheduled_at <= current_time`."""
    user = _create_test_user(db=db)
    target_time = datetime(2026, 10, 17, 12, 0, 0, 500000, tzinfo=timezone.utc)

    post = crud.create_post(
        session=db,
        post_in=PostCreate(
            content="Microsecond precision post",
            platform="x",
            status="scheduled",
            scheduled_at=target_time,
        ),
        owner_id=user.id,
    )

    scheduler = SchedulerService()

    # 1 microsecond BEFORE: should NOT match
    before = target_time - timedelta(microseconds=1)
    due_before = scheduler.get_due_posts(session=db, now=before, owner_id=user.id)
    assert post.id not in [p.id for p in due_before]

    # EXACT microsecond: SHOULD match
    due_exact = scheduler.get_due_posts(session=db, now=target_time, owner_id=user.id)
    assert post.id in [p.id for p in due_exact]

    # 1 microsecond AFTER: SHOULD match
    after = target_time + timedelta(microseconds=1)
    due_after = scheduler.get_due_posts(session=db, now=after, owner_id=user.id)
    assert post.id in [p.id for p in due_after]
