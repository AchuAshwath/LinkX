from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import MagicMock

import pytest
from sqlmodel import Session

from app import crud
from app.models import (
    PostCreate,
    PublishErrorResponse,
    User,
    UserCreate,
)
from app.services.publishing import PublishFailure
from app.services.scheduler import (
    ErrorClassifier,
    RedisDistributedLock,
    RetryPolicy,
    SchedulerService,
)
from tests.utils.utils import random_email, random_lower_string


def _make_user(*, db: Session) -> User:
    return crud.create_user(
        session=db,
        user_create=UserCreate(
            email=random_email(),
            password=random_lower_string(),
        ),
    )


def test_error_classifier_identifies_retryable_errors() -> None:
    """Verify HTTP 429, 5xx, and network timeouts are classified as retryable."""
    classifier = ErrorClassifier()

    assert classifier.is_retryable(status_code=429) is True
    assert classifier.classify_error(status_code=429) == "RATE_LIMITED"

    assert classifier.is_retryable(status_code=500) is True
    assert classifier.classify_error(status_code=500) == "SERVER_ERROR"

    assert classifier.is_retryable(status_code=502) is True
    assert classifier.classify_error(status_code=502) == "SERVER_ERROR"

    assert classifier.is_retryable(status_code=503) is True
    assert classifier.is_retryable(status_code=504) is True


def test_error_classifier_identifies_fatal_errors() -> None:
    """Verify HTTP 400, 401, 403, and 404 are classified as fatal (non-retryable)."""
    classifier = ErrorClassifier()

    assert classifier.is_retryable(status_code=400) is False
    assert classifier.classify_error(status_code=400) == "CLIENT_ERROR"

    assert classifier.is_retryable(status_code=401) is False
    assert classifier.classify_error(status_code=401) == "AUTH_ERROR"

    assert classifier.is_retryable(status_code=403) is False
    assert classifier.classify_error(status_code=403) == "FORBIDDEN"

    assert classifier.is_retryable(status_code=404) is False


def test_retry_policy_exponential_backoff() -> None:
    """Verify exponential backoff calculation: 60s -> 120s -> 240s with max 3 retries."""
    policy = RetryPolicy(
        initial_delay_seconds=60,
        backoff_multiplier=2.0,
        max_retries=3,
    )
    base_time = datetime(2026, 10, 17, 12, 0, 0, tzinfo=timezone.utc)

    # Retry 0: base + 60s
    t0 = policy.calculate_next_retry(retry_count=0, now=base_time)
    assert t0 == datetime(2026, 10, 17, 12, 1, 0, tzinfo=timezone.utc)

    # Retry 1: base + 120s
    t1 = policy.calculate_next_retry(retry_count=1, now=base_time)
    assert t1 == datetime(2026, 10, 17, 12, 2, 0, tzinfo=timezone.utc)

    # Retry 2: base + 240s
    t2 = policy.calculate_next_retry(retry_count=2, now=base_time)
    assert t2 == datetime(2026, 10, 17, 12, 4, 0, tzinfo=timezone.utc)

    # Max retries exceeded
    assert policy.can_retry(retry_count=0) is True
    assert policy.can_retry(retry_count=1) is True
    assert policy.can_retry(retry_count=2) is True
    assert policy.can_retry(retry_count=3) is False
    assert policy.calculate_next_retry(retry_count=3, now=base_time) is None


def test_redis_distributed_lock_acquisition_and_release() -> None:
    """Verify lock acquires with NX/EX and releases on context exit."""
    from unittest.mock import MagicMock

    from app.services.scheduler import RedisDistributedLock

    mock_redis = MagicMock()
    mock_redis.set.return_value = True
    mock_redis.eval.return_value = 1

    with RedisDistributedLock(
        redis_client=mock_redis, lock_key="test:lock", expire_seconds=30
    ) as acquired:
        assert acquired is True
        mock_redis.set.assert_called_once()
        args, kwargs = mock_redis.set.call_args
        assert args[0] == "test:lock"
        assert kwargs.get("nx") is True
        assert kwargs.get("ex") == 30

    mock_redis.eval.assert_called_once()


def test_redis_distributed_lock_contention() -> None:
    """Verify lock returns False when key is already held by another worker."""
    mock_redis = MagicMock()
    mock_redis.set.return_value = None  # Key already exists in Redis

    with RedisDistributedLock(
        redis_client=mock_redis, lock_key="test:lock"
    ) as acquired:
        assert acquired is False

    mock_redis.eval.assert_not_called()


@pytest.mark.anyio
async def test_process_due_posts_success_transitions_to_published(db: Session) -> None:
    """Verify due scheduled posts are published and external_post_id is recorded."""
    user = _make_user(db=db)
    due_time = datetime.now(timezone.utc) - timedelta(minutes=5)
    post = crud.create_post(
        session=db,
        post_in=PostCreate(
            content="Scheduled announcement for LinkX followers",
            platform="x",
            status="scheduled",
            scheduled_at=due_time,
        ),
        owner_id=user.id,
    )

    fake_publisher = MagicMock(
        return_value={"external_id": "tweet_999000", "url": "https://x.com/post/999000"}
    )
    scheduler = SchedulerService(publish_fn=fake_publisher)

    summary = await scheduler.process_due_posts(
        session=db, owner_id=user.id, redis_client=None
    )

    assert summary["processed"] == 1
    assert summary["published"] == 1
    assert summary["failed"] == 0

    db.refresh(post)
    assert post.status == "published"
    assert post.external_post_id == "tweet_999000"
    assert post.published_at is not None
    fake_publisher.assert_called_once()


@pytest.mark.anyio
async def test_process_due_posts_retryable_error_increments_retry_count(
    db: Session,
) -> None:
    """Verify HTTP 429 rate limit triggers exponential backoff and stays in scheduled state."""
    user = _make_user(db=db)
    due_time = datetime.now(timezone.utc) - timedelta(minutes=5)
    post = crud.create_post(
        session=db,
        post_in=PostCreate(
            content="Viral post encountering platform rate limit",
            platform="x",
            status="scheduled",
            scheduled_at=due_time,
        ),
        owner_id=user.id,
    )

    def _failing_publish(**_kwargs: Any) -> PublishFailure:
        return PublishFailure(
            status_code=429,
            payload=PublishErrorResponse(
                error="rate_limit",
                message="Rate limit exceeded on X API",
                retryable=True,
                trace_id="tr-429",
            ),
        )

    scheduler = SchedulerService(publish_fn=_failing_publish)
    summary = await scheduler.process_due_posts(
        session=db, owner_id=user.id, redis_client=None
    )

    assert summary["processed"] == 1
    assert summary["published"] == 0
    assert summary["retried"] == 1

    db.refresh(post)
    assert post.status == "scheduled"
    assert post.retry_count == 1
    assert post.next_retry_at is not None
    assert post.next_retry_at > datetime.now(timezone.utc)
    assert post.error_code == "RATE_LIMITED"
    assert "Rate limit exceeded" in str(post.error_message)


@pytest.mark.anyio
async def test_process_due_posts_fatal_error_transitions_to_failed(db: Session) -> None:
    """Verify HTTP 401 unauthorized immediately marks post as failed with error code."""
    user = _make_user(db=db)
    due_time = datetime.now(timezone.utc) - timedelta(minutes=5)
    post = crud.create_post(
        session=db,
        post_in=PostCreate(
            content="Post with expired account token",
            platform="linkedin",
            status="scheduled",
            scheduled_at=due_time,
        ),
        owner_id=user.id,
    )

    def _unauthorized_publish(**_kwargs: Any) -> PublishFailure:
        return PublishFailure(
            status_code=401,
            payload=PublishErrorResponse(
                error="unauthorized",
                message="LinkedIn token expired",
                retryable=False,
                trace_id="tr-401",
            ),
        )

    scheduler = SchedulerService(publish_fn=_unauthorized_publish)
    summary = await scheduler.process_due_posts(
        session=db, owner_id=user.id, redis_client=None
    )

    assert summary["processed"] == 1
    assert summary["published"] == 0
    assert summary["failed"] == 1

    db.refresh(post)
    assert post.status == "failed"
    assert post.error_code == "AUTH_ERROR"
    assert "LinkedIn token expired" in str(post.error_message)


@pytest.mark.anyio
async def test_process_due_posts_idempotency_prevents_duplicate_publishing(
    db: Session,
) -> None:
    """Verify that a post with an existing external_post_id is never re-published."""
    user = _make_user(db=db)
    due_time = datetime.now(timezone.utc) - timedelta(minutes=5)
    post = crud.create_post(
        session=db,
        post_in=PostCreate(
            content="Already published externally but status was unrecorded",
            platform="x",
            status="scheduled",
            scheduled_at=due_time,
        ),
        owner_id=user.id,
    )
    post.external_post_id = "ext-existing-123"
    db.add(post)
    db.commit()
    db.refresh(post)

    fake_publisher = MagicMock()
    scheduler = SchedulerService(publish_fn=fake_publisher)

    summary = await scheduler.process_due_posts(
        session=db, owner_id=user.id, redis_client=None
    )

    assert summary["processed"] == 1
    assert summary["published"] == 1
    fake_publisher.assert_not_called()

    db.refresh(post)
    assert post.status == "published"
