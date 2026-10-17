from dataclasses import dataclass
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


@pytest.mark.parametrize(
    "status_code, expected_retryable, expected_code",
    [
        (429, True, "RATE_LIMITED"),
        (500, True, "SERVER_ERROR"),
        (502, True, "SERVER_ERROR"),
        (503, True, "SERVER_ERROR"),
        (504, True, "SERVER_ERROR"),
        (400, False, "CLIENT_ERROR"),
        (401, False, "AUTH_ERROR"),
        (403, False, "FORBIDDEN"),
        (404, False, "CLIENT_ERROR"),
    ],
)
def test_error_classifier_classifications(
    status_code: int, expected_retryable: bool, expected_code: str
) -> None:
    """Verify HTTP status codes map to correct retryability and error codes."""
    classifier = ErrorClassifier()
    assert classifier.is_retryable(status_code=status_code) is expected_retryable
    assert classifier.classify_error(status_code=status_code) == expected_code


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


@dataclass
class PublishFailureCase:
    status_code: int
    error_key: str
    error_msg: str
    summary_key: str
    target_status: str
    error_code: str


@pytest.mark.anyio
@pytest.mark.parametrize(
    "case",
    [
        PublishFailureCase(
            status_code=429,
            error_key="rate_limit",
            error_msg="Rate limit exceeded on X API",
            summary_key="retried",
            target_status="scheduled",
            error_code="RATE_LIMITED",
        ),
        PublishFailureCase(
            status_code=401,
            error_key="unauthorized",
            error_msg="LinkedIn token expired",
            summary_key="failed",
            target_status="failed",
            error_code="AUTH_ERROR",
        ),
    ],
)
async def test_process_due_posts_handles_publish_failure(
    db: Session,
    case: PublishFailureCase,
) -> None:
    """Verify process_due_posts properly routes retryable vs fatal publishing failures."""
    user = _make_user(db=db)
    due_time = datetime.now(timezone.utc) - timedelta(minutes=5)
    post = crud.create_post(
        session=db,
        post_in=PostCreate(
            content=f"Post encountering {case.error_key}",
            platform="x",
            status="scheduled",
            scheduled_at=due_time,
        ),
        owner_id=user.id,
    )

    def _failing_publish(**_kwargs: Any) -> PublishFailure:
        return PublishFailure(
            status_code=case.status_code,
            payload=PublishErrorResponse(
                error=case.error_key,
                message=case.error_msg,
                retryable=(case.status_code == 429),
                trace_id="tr-err",
            ),
        )

    scheduler = SchedulerService(publish_fn=_failing_publish)
    summary = await scheduler.process_due_posts(
        session=db, owner_id=user.id, redis_client=None
    )

    assert summary["processed"] == 1
    assert summary[case.summary_key] == 1

    db.refresh(post)
    assert post.status == case.target_status
    assert post.error_code == case.error_code
    assert case.error_msg in str(post.error_message)
    if case.target_status == "scheduled":
        assert post.retry_count == 1
        assert post.next_retry_at is not None


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
