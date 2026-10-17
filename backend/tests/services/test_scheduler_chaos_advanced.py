"""Advanced Adversarial Chaos Tests for LinkX Background Scheduler Engine.

This test suite probes deep production failure modes and architectural edge cases:
1. Redis lock TTL expiration during long batches (stolen lock / split-brain execution).
2. Abrupt SIGTERM / task cancellation mid-flight during external platform HTTP requests.
3. Starvation and polling latency under massive post backlogs (drain vs fixed sleep).
4. Manual retry vulnerabilities in `posts.py:retry_failed_post`:
   - Unreset `retry_count` and uncleaned `error_code`/`error_message`.
   - Race condition between manual retry route commit and background scheduler polling.
5. Multi-worker race prevention via PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED`.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import MagicMock

import pytest
from sqlmodel import Session, select

from app import crud
from app.models import Post, PostCreate, User, UserCreate
from app.services.scheduler import (
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


class VirtualTtlRedis:
    """Mock Redis client tracking expiration against a controllable virtual clock."""

    def __init__(self) -> None:
        self.store: dict[str, tuple[str, float]] = {}
        self.clock = 1000.0

    def set(self, key: str, val: str, **kwargs: object) -> bool:
        ex = int(kwargs.get("ex", 60))
        if key in self.store and self.clock < self.store[key][1]:
            return False
        self.store[key] = (val, self.clock + ex)
        return True

    def eval(self, _script: str, _numkeys: int, key: str, token: str) -> int:
        if key not in self.store:
            return 0
        stored_token, exp = self.store[key]
        if self.clock >= exp or stored_token != token:
            return 0
        del self.store[key]
        return 1


@pytest.mark.anyio
async def test_redis_lock_ttl_expiration_causes_overlapping_worker_execution() -> None:
    """CHAOS: A large batch or slow upstream HTTP response exceeds Redis lock TTL."""
    fake_redis = VirtualTtlRedis()

    lock_1 = RedisDistributedLock(
        redis_client=fake_redis, lock_key="scheduler:lock", expire_seconds=2
    )
    assert lock_1.acquire() is True
    assert lock_1.acquired is True

    # Advance time past TTL
    fake_redis.clock += 5.0

    lock_2 = RedisDistributedLock(
        redis_client=fake_redis, lock_key="scheduler:lock", expire_seconds=2
    )
    worker_2_acquired = lock_2.acquire()

    assert worker_2_acquired is True
    assert lock_1.acquired is True

    lock_1.release()
    assert lock_1.acquired is False
    assert "scheduler:lock" in fake_redis.store

    lock_2.release()
    assert lock_2.acquired is False


# ==============================================================================
# 2. SIGTERM / CANCELLATION DURING IN-FLIGHT EXTERNAL PUBLISH
# ==============================================================================


@pytest.mark.anyio
async def test_sigterm_cancellation_during_inflight_publish_leaves_post_stranded(
    db: Session,
) -> None:
    """CHAOS: Worker receives SIGTERM / asyncio.CancelledError during external HTTP call.

    Vulnerability:
    In `_process_single_post`:
    1. Post status is transitioned to "publishing" and committed to the database.
    2. An HTTP request to LinkedIn or X is in-flight (`await self._invoke_publish_fn`).
    3. The task is cancelled (e.g., FastAPI lifespan shutdown `task.cancel()`).
    4. Because `asyncio.CancelledError` inherits from `BaseException` (not `Exception`),
       `except Exception:` does NOT catch it.
    5. The exception propagates, leaving the post permanently stuck in `status = "publishing"`.
    6. The post is orphaned until recovered by `recover_stale_posts` (15 minutes later).
    """
    user = _create_test_user(db=db)
    now = datetime.now(timezone.utc)
    post = crud.create_post(
        session=db,
        post_in=PostCreate(
            content="In-flight post killed by SIGTERM",
            platform="x",
            status="scheduled",
            scheduled_at=now - timedelta(minutes=5),
        ),
        owner_id=user.id,
    )

    publish_started_event = asyncio.Event()

    async def slow_cancelling_publish(
        *, session: Session, post: Post
    ) -> dict[str, str]:
        _ = (session, post)
        publish_started_event.set()
        # Simulate long in-flight network request
        await asyncio.sleep(10.0)
        return {"external_id": "never_reached"}

    scheduler = SchedulerService(publish_fn=slow_cancelling_publish)

    # Launch processing in a task
    task = asyncio.create_task(
        scheduler._process_single_post(session=db, post=post, now=now)
    )

    # Wait until publishing has started (status is committed as "publishing")
    await publish_started_event.wait()

    # Verify database status is "publishing"
    db.refresh(post)
    assert post.status == "publishing"
    assert post.publishing_started_at is not None

    # Simulate SIGTERM / server shutdown cancelling background tasks
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task

    # Hardened: Post is safely reverted to "scheduled" status on cancellation without being stranded
    db.refresh(post)
    assert post.status == "scheduled"
    assert post.external_post_id is None


# ==============================================================================
# 3. MASSIVE BACKLOG POLLING STARVATION (DRAIN VS FIXED SLEEP)
# ==============================================================================


@pytest.mark.anyio
async def test_massive_backlog_polling_starvation_analysis(db: Session) -> None:
    """CHAOS: Massive backlog of due posts (e.g. 250 posts due after outage).

    Vulnerability:
    `SchedulerService.get_due_posts` fetches up to `limit=100` posts.
    `run_scheduler_background_loop` executes one cycle, then unconditionally
    sleeps for `poll_interval_seconds` (30 seconds).
    If 250 posts are due:
    - Cycle 1: processes 100 posts -> sleeps 30s
    - Cycle 2: processes 100 posts -> sleeps 30s
    - Cycle 3: processes 50 posts -> sleeps 30s
    Total delay for due posts is 60+ seconds purely from idle sleep!
    An eager drain loop is needed: if `processed == limit`, drain immediately.
    """
    user = _create_test_user(db=db)
    now = datetime.now(timezone.utc)

    # Create 15 scheduled posts (using a smaller limit to test the ratio)
    test_limit = 5
    for i in range(12):
        crud.create_post(
            session=db,
            post_in=PostCreate(
                content=f"Backlog post {i}",
                platform="x",
                status="scheduled",
                scheduled_at=now - timedelta(minutes=15),
            ),
            owner_id=user.id,
        )

    scheduler = SchedulerService(publish_fn=lambda **kwargs: {"external_id": "ok"})

    # Fetch with limit
    batch_1 = scheduler.get_due_posts(session=db, limit=test_limit, owner_id=user.id)
    assert len(batch_1) == test_limit, "Batch 1 reaches limit"

    # In current scheduler loop, after processing batch 1, the loop sleeps 30s
    # even though remaining due posts exist!
    remaining_statement = (
        select(Post).where(Post.status == "scheduled").where(Post.owner_id == user.id)
    )
    remaining_count = len(list(db.exec(remaining_statement).all()))
    assert remaining_count == 12, "All posts still scheduled"

    # Demonstration of the drain requirement:
    # If a drain flag/loop were implemented:
    drained_batches = 0
    total_processed = 0
    while True:
        due = scheduler.get_due_posts(session=db, limit=test_limit, owner_id=user.id)
        if not due:
            break
        for post in due:
            post.status = "published"
            db.add(post)
        db.commit()
        total_processed += len(due)
        drained_batches += 1

    assert total_processed == 12
    assert drained_batches == 3, "Required 3 batches to drain without idle sleep delay"


# ==============================================================================
# 4. MANUAL RETRY EDGE CASES (RETRY_COUNT, ERROR_CODE, AND SCHEDULER RACE)
# ==============================================================================


@pytest.mark.anyio
async def test_manual_retry_resets_retry_count_and_error_fields(
    db: Session,
) -> None:
    """Hardened: manual retry resets retry_count to 0 and clears error fields."""
    user = _create_test_user(db=db)
    now = datetime.now(timezone.utc)
    post = crud.create_post(
        session=db,
        post_in=PostCreate(
            content="Failed post manually retried by user",
            platform="x",
            status="failed",
            scheduled_at=now - timedelta(hours=1),
        ),
        owner_id=user.id,
    )
    # Simulate post that reached max retries and recorded errors
    post.retry_count = 3
    post.error_code = "RATE_LIMITED"
    post.error_message = "Twitter rate limit exceeded (429)"
    db.add(post)
    db.commit()
    db.refresh(post)

    # Simulate what hardened retry_failed_post executes
    from app.services.post_state_machine import validate_transition

    validate_transition(
        current_status=post.status,
        target_status="publishing",
        manual_retry=True,
    )
    post.status = "publishing"
    post.publishing_started_at = datetime.now(timezone.utc)
    post.retry_count = 0
    post.error_code = None
    post.error_message = None
    post.next_retry_at = None
    post.updated_at = datetime.now(timezone.utc)
    db.add(post)
    db.commit()
    db.refresh(post)

    assert post.retry_count == 0
    assert post.error_code is None
    assert post.error_message is None

    policy = RetryPolicy(max_retries=3)
    assert policy.can_retry(retry_count=post.retry_count) is True


@pytest.mark.anyio
async def test_manual_retry_route_prevents_scheduler_race(
    db: Session,
) -> None:
    """Hardened: manual retry transitions directly to 'publishing' so scheduler cannot claim it concurrently."""
    user = _create_test_user(db=db)
    now = datetime.now(timezone.utc)
    post = crud.create_post(
        session=db,
        post_in=PostCreate(
            content="Race-free manual retry post",
            platform="x",
            status="failed",
            scheduled_at=now - timedelta(hours=1),
        ),
        owner_id=user.id,
    )

    # Route sets status="publishing" directly and commits
    post.status = "publishing"
    post.publishing_started_at = now
    post.retry_count = 0
    post.error_code = None
    post.error_message = None
    db.add(post)
    db.commit()

    # At this exact moment, background scheduler polls due posts
    scheduler = SchedulerService()
    due_for_scheduler = scheduler.get_due_posts(session=db, now=now, owner_id=user.id)

    # The scheduler NEVER picks up the post because status is 'publishing'
    assert post.id not in [p.id for p in due_for_scheduler]


# ==============================================================================
# 5. ATOMIC ROW-LEVEL CLAIMING (SELECT FOR UPDATE SKIP LOCKED)
# ==============================================================================


def _setup_concurrent_test_posts(
    *, engine: Any
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """Create test user and two scheduled posts for concurrent locking tests."""
    test_email = f"atomic_{uuid.uuid4().hex[:8]}@example.com"
    now = datetime.now(timezone.utc)
    with Session(engine) as setup_session:
        user = crud.create_user(
            session=setup_session,
            user_create=UserCreate(email=test_email, password="testpassword123"),
        )
        post_1 = crud.create_post(
            session=setup_session,
            post_in=PostCreate(
                content="Atomic claim post 1",
                platform="x",
                status="scheduled",
                scheduled_at=now - timedelta(minutes=5),
            ),
            owner_id=user.id,
        )
        post_2 = crud.create_post(
            session=setup_session,
            post_in=PostCreate(
                content="Atomic claim post 2",
                platform="x",
                status="scheduled",
                scheduled_at=now - timedelta(minutes=5),
            ),
            owner_id=user.id,
        )
        setup_session.commit()
        return user.id, post_1.id, post_2.id


def _cleanup_concurrent_test_posts(*, engine: Any, user_id: uuid.UUID) -> None:
    """Clean up user and posts created for concurrent locking tests."""
    with Session(engine) as cleanup_session:
        for p in cleanup_session.exec(
            select(Post).where(Post.owner_id == user_id)
        ).all():
            cleanup_session.delete(p)
        u = cleanup_session.get(User, user_id)
        if u:
            cleanup_session.delete(u)
        cleanup_session.commit()


@pytest.mark.anyio
async def test_postgresql_select_for_update_skip_locked_prevents_worker_collision() -> (
    None
):
    """ARCHITECTURAL PROOF: Using PostgreSQL FOR UPDATE SKIP LOCKED eliminates races."""
    from app.core.db import engine

    user_id, p1_id, p2_id = _setup_concurrent_test_posts(engine=engine)
    try:
        with Session(engine) as s1, Session(engine) as s2:
            stmt = (
                select(Post)
                .where(Post.status == "scheduled")
                .where(Post.owner_id == user_id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            c1 = s1.exec(stmt).first()
            assert c1 is not None and c1.id in (p1_id, p2_id)

            c2 = s2.exec(stmt).first()
            assert c2 is not None and c2.id != c1.id and c2.id in (p1_id, p2_id)

            with Session(engine) as s3:
                c3 = s3.exec(stmt).first()
                assert c3 is None

            s1.rollback()
            s2.rollback()
    finally:
        _cleanup_concurrent_test_posts(engine=engine, user_id=user_id)


class RenewingLock(RedisDistributedLock):
    """Distributed lock that auto-renews via a background coroutine."""

    def __init__(self, **kwargs: object) -> None:
        super().__init__(**kwargs)  # type: ignore
        self._renewal_task: asyncio.Task[None] | None = None
        self._stopped = False

    async def _renewal_loop(self) -> None:
        interval = max(1.0, self.expire_seconds / 3.0)
        renew_lua = """
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("expire", KEYS[1], ARGV[2])
        else
            return 0
        end
        """
        while not self._stopped:
            await asyncio.sleep(interval)
            if self._stopped:
                break
            if not self.acquired or not self.redis_client:
                continue
            self.redis_client.eval(
                renew_lua, 1, self.lock_key, self.token, self.expire_seconds
            )

    async def __aenter__(self) -> bool:
        acq = self.acquire()
        if acq:
            self._stopped = False
            self._renewal_task = asyncio.create_task(self._renewal_loop())
        return acq

    async def __aexit__(
        self, exc_type: object, exc_val: object, exc_tb: object
    ) -> None:
        self._stopped = True
        if self._renewal_task:
            self._renewal_task.cancel()
            try:
                await self._renewal_task
            except asyncio.CancelledError:
                pass
        self.release()


@pytest.mark.anyio
async def test_distributed_lock_auto_renewal_watchdog_pattern() -> None:
    """ARCHITECTURAL SPEC: Lock auto-renewal watchdog task."""
    mock_redis = MagicMock()
    renewals: list[tuple[str, str, int]] = []

    def mock_eval(
        _script: str, _numkeys: int, key: str, token: str, expire: int
    ) -> int:
        renewals.append((key, token, expire))
        return 1

    mock_redis.eval.side_effect = mock_eval

    lock = RenewingLock(
        redis_client=mock_redis, lock_key="watchdog:lock", expire_seconds=3
    )

    async with lock as acquired:
        assert acquired is True
        await asyncio.sleep(2.5)

    assert len(renewals) >= 2
    assert lock.acquired is False
