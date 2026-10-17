"""Background post scheduling service and retry reliability engine."""

from __future__ import annotations

import asyncio
import inspect
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlmodel import Session, col, or_, select

from app.models import Post
from app.services.post_state_machine import validate_transition
from app.services.publishing import PublishFailure, publish_post

logger = logging.getLogger(__name__)


def _safe_int_status(val: Any) -> int | None:
    """Safely convert status code representation to int or None."""
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def _truncate_error_message(message: str, max_chars: int = 990) -> str:
    """Truncate message to fit within the database VARCHAR(1000) column."""
    if len(message) > max_chars:
        return f"{message[:max_chars]}..."
    return message


def _extract_error_message(res: Any) -> str:
    """Extract error detail message safely from PublishFailure payload or dict."""
    if not hasattr(res, "payload") or res.payload is None:
        return "Publishing failed"
    payload = res.payload
    if isinstance(payload, dict):
        msg = payload.get("message") or payload.get("detail") or payload.get("error")
        return str(msg) if msg else "Publishing failed"
    for attr in ("message", "detail", "error"):
        val = getattr(payload, attr, None)
        if val:
            return str(val)
    return "Publishing failed"


def _extract_external_id(res: Any) -> str | None:
    """Extract external platform ID safely from publishing return value."""
    if isinstance(res, dict):
        val = res.get("external_id")
        return str(val) if val else None
    if hasattr(res, "external_id"):
        val = res.external_id
        return str(val) if val else None
    if isinstance(res, str) and res:
        return res
    return None


@dataclass
class FailureDetail:
    """Encapsulates execution failure metadata."""

    status_code: int | None = None
    error_message: str = "Publishing failed"
    now: datetime | None = None


class ErrorClassifier:
    """Classifies HTTP and execution exceptions into retryable vs fatal errors."""

    RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}

    def is_retryable(self, *, status_code: Any = None) -> bool:
        """Determine whether the failure should trigger an automatic retry."""
        code = _safe_int_status(status_code)
        if code is None:
            return True  # Generic network/connection exceptions are retryable
        return code in self.RETRYABLE_STATUS_CODES

    def classify_error(self, *, status_code: Any = None) -> str:
        """Return a standardized error code string for telemetry and database records."""
        code = _safe_int_status(status_code)
        if code == 429:
            return "RATE_LIMITED"
        if code and 500 <= code < 600:
            return "SERVER_ERROR"
        if code == 401:
            return "AUTH_ERROR"
        if code == 403:
            return "FORBIDDEN"
        if code and 400 <= code < 500:
            return "CLIENT_ERROR"
        return "NETWORK_ERROR"


class RetryPolicy:
    """Calculates exponential backoff and determines retry eligibility."""

    def __init__(
        self,
        *,
        initial_delay_seconds: int = 60,
        backoff_multiplier: float = 2.0,
        max_retries: int = 3,
        max_delay_seconds: int = 86400,
    ) -> None:
        self.initial_delay_seconds = initial_delay_seconds
        self.backoff_multiplier = backoff_multiplier
        self.max_retries = max_retries
        self.max_delay_seconds = max_delay_seconds

    def can_retry(self, *, retry_count: int) -> bool:
        """Check if remaining retries exist for the post."""
        return retry_count < self.max_retries

    def calculate_next_retry(
        self,
        *,
        retry_count: int,
        now: datetime | None = None,
    ) -> datetime | None:
        """Calculate the UTC timestamp for the next retry attempt."""
        if not self.can_retry(retry_count=retry_count):
            return None

        current_time = now or datetime.now(timezone.utc)
        if current_time.tzinfo is None:
            current_time = current_time.replace(tzinfo=timezone.utc)

        effective_retries = max(0, min(retry_count, 30))
        calculated_delay = self.initial_delay_seconds * (
            self.backoff_multiplier**effective_retries
        )
        delay_seconds = min(calculated_delay, float(self.max_delay_seconds))
        return current_time + timedelta(seconds=delay_seconds)


# Safe Lua script that atomically checks token equality before deleting the lock
RELEASE_LOCK_LUA_SCRIPT = """
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
"""

# Safe Lua script that atomically checks token equality before extending lock TTL
RENEW_LOCK_LUA_SCRIPT = """
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("expire", KEYS[1], ARGV[2])
else
    return 0
end
"""


class RedisDistributedLock:
    """Distributed lock manager using Redis SETNX with automatic TTL and safe release."""

    def __init__(
        self,
        *,
        redis_client: Any | None,
        lock_key: str = "linkx:scheduler:lock",
        expire_seconds: int = 60,
    ) -> None:
        self.redis_client = redis_client
        self.lock_key = lock_key
        self.expire_seconds = expire_seconds
        self.token = str(uuid.uuid4())
        self.acquired = False

    def acquire(self) -> bool:
        """Attempt to acquire the distributed lock."""
        if self.redis_client is None:
            logger.debug("No Redis client provided; proceeding with standalone lock")
            self.acquired = True
            return True

        try:
            result = self.redis_client.set(
                self.lock_key,
                self.token,
                nx=True,
                ex=self.expire_seconds,
            )
            self.acquired = bool(result)
            return self.acquired
        except Exception as exc:
            logger.warning("Redis lock acquisition failed with error: %s", exc)
            return False

    def release(self) -> None:
        """Atomically release the lock if the token matches."""
        if not self.acquired or self.redis_client is None:
            return

        try:
            self.redis_client.eval(
                RELEASE_LOCK_LUA_SCRIPT,
                1,
                self.lock_key,
                self.token,
            )
        except Exception as exc:
            logger.warning("Redis lock release failed with error: %s", exc)
        finally:
            self.acquired = False

    def is_held(self) -> bool:
        """Verify whether this instance currently holds the lock in Redis."""
        if not self.acquired:
            return False
        if self.redis_client is None:
            return True
        try:
            val = self.redis_client.get(self.lock_key)
            if isinstance(val, bytes):
                val = val.decode("utf-8")
            return bool(val == self.token)
        except Exception as exc:
            logger.warning("Error checking lock ownership: %s", exc)
            return False

    def renew(self, *, additional_seconds: int | None = None) -> bool:
        """Extend lock TTL if token still matches."""
        if not self.acquired:
            return False
        if self.redis_client is None:
            return True
        ttl = additional_seconds or self.expire_seconds
        try:
            res = self.redis_client.eval(
                RENEW_LOCK_LUA_SCRIPT,
                1,
                self.lock_key,
                self.token,
                ttl,
            )
            return bool(res)
        except Exception as exc:
            logger.warning("Redis lock renewal failed: %s", exc)
            return False

    def __enter__(self) -> bool:
        return self.acquire()

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.release()

    async def __aenter__(self) -> bool:
        return self.acquire()

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.release()


class SchedulerService:
    """Orchestrates polling, distributed locking, atomic publishing, and retries for scheduled posts."""

    def __init__(
        self,
        *,
        publish_fn: Callable[..., Any] | None = None,
        error_classifier: ErrorClassifier | None = None,
        retry_policy: RetryPolicy | None = None,
    ) -> None:
        self.publish_fn = publish_fn or publish_post
        self.error_classifier = error_classifier or ErrorClassifier()
        self.retry_policy = retry_policy or RetryPolicy()

    def get_due_posts(
        self,
        *,
        session: Session,
        now: datetime | None = None,
        owner_id: uuid.UUID | None = None,
        limit: int = 100,
    ) -> list[Post]:
        """Fetch all posts scheduled at or before now that are ready for execution."""
        current_time = now or datetime.now(timezone.utc)
        statement = (
            select(Post)
            .where(Post.status == "scheduled")
            .where(col(Post.scheduled_at) <= current_time)
            .where(
                or_(
                    col(Post.next_retry_at).is_(None),
                    col(Post.next_retry_at) <= current_time,
                )
            )
        )
        if owner_id is not None:
            statement = statement.where(Post.owner_id == owner_id)

        statement = statement.order_by(col(Post.scheduled_at).asc()).limit(limit)

        bind = session.get_bind()
        if bind is not None and getattr(bind.dialect, "name", "") == "postgresql":
            statement = statement.with_for_update(skip_locked=True)

        return list(session.exec(statement).all())

    def recover_stale_posts(
        self,
        *,
        session: Session,
        stale_threshold_minutes: int = 15,
        now: datetime | None = None,
    ) -> int:
        """Recover posts stranded in 'publishing' status due to worker crash or timeout."""
        current_time = now or datetime.now(timezone.utc)
        cutoff = current_time - timedelta(minutes=stale_threshold_minutes)
        statement = (
            select(Post)
            .where(Post.status == "publishing")
            .where(
                or_(
                    col(Post.publishing_started_at).is_(None),
                    col(Post.publishing_started_at) <= cutoff,
                )
            )
        )
        stale_posts = list(session.exec(statement).all())
        for post in stale_posts:
            post.status = "scheduled"
            post.retry_count += 1
            post.error_code = "STALE_TIMEOUT"
            post.error_message = f"Execution timed out or crashed while in publishing status after {stale_threshold_minutes}m"
            post.next_retry_at = self.retry_policy.calculate_next_retry(
                retry_count=post.retry_count, now=current_time
            )
            session.add(post)

        if stale_posts:
            session.commit()
            logger.warning("Recovered %d stale publishing posts", len(stale_posts))
        return len(stale_posts)

    def _handle_failure(
        self,
        *,
        session: Session,
        post: Post,
        failure: FailureDetail,
    ) -> str:
        """Handle execution failure, transitioning to retry backoff or terminal failed state."""
        current_time = failure.now or datetime.now(timezone.utc)
        safe_message = _truncate_error_message(failure.error_message)
        is_retryable = self.error_classifier.is_retryable(
            status_code=failure.status_code
        )
        can_retry = self.retry_policy.can_retry(retry_count=post.retry_count)
        error_code = self.error_classifier.classify_error(
            status_code=failure.status_code
        )

        if is_retryable and can_retry:
            post.retry_count += 1
            post.last_retry_at = current_time
            post.next_retry_at = self.retry_policy.calculate_next_retry(
                retry_count=post.retry_count, now=current_time
            )
            post.status = "scheduled"
            post.error_code = error_code
            post.error_message = safe_message
            session.add(post)
            session.commit()
            return "retried"

        post.status = "failed"
        post.error_code = error_code
        post.error_message = safe_message
        session.add(post)
        session.commit()
        return "failed"

    async def _invoke_publish_fn(self, *, session: Session, post: Post) -> Any:
        """Invoke synchronous or asynchronous publish callable."""
        if inspect.iscoroutinefunction(self.publish_fn):
            return await self.publish_fn(session=session, post=post)
        res = self.publish_fn(session=session, post=post)
        if inspect.isawaitable(res):
            return await res
        return res

    def _mark_published(
        self,
        *,
        session: Session,
        post: Post,
        ext_id: str | None = None,
        now: datetime,
    ) -> None:
        """Mark post as published and persist changes."""
        post.status = "published"
        post.published_at = post.published_at or now
        if ext_id:
            post.external_post_id = ext_id
        post.error_code = None
        post.error_message = None
        session.add(post)
        session.commit()

    def _revert_on_cancellation(self, *, session: Session, post: Post) -> None:
        """Revert post to scheduled if interrupted while publishing."""
        try:
            session.refresh(post)
            if post.status == "publishing" and not post.external_post_id:
                post.status = "scheduled"
                session.add(post)
                session.commit()
        except Exception:
            session.rollback()

    async def _process_single_post(
        self,
        *,
        session: Session,
        post: Post,
        now: datetime,
    ) -> str:
        """Atomically transition and publish an individual scheduled post."""
        if post.external_post_id:
            logger.info("Post %s has external ID; skipping duplicate", post.id)
            self._mark_published(session=session, post=post, now=now)
            return "published"

        try:
            validate_transition(current_status=post.status, target_status="publishing")
        except ValueError as exc:
            logger.warning("Invalid transition for post %s: %s", post.id, exc)
            return "skipped"

        post.status = "publishing"
        post.publishing_started_at = now
        session.add(post)
        session.commit()

        try:
            res = await asyncio.shield(
                self._invoke_publish_fn(session=session, post=post)
            )
            if isinstance(res, PublishFailure):
                failure = FailureDetail(
                    status_code=res.status_code,
                    error_message=_extract_error_message(res),
                    now=now,
                )
                return self._handle_failure(session=session, post=post, failure=failure)

            ext_id = _extract_external_id(res)
            self._mark_published(session=session, post=post, ext_id=ext_id, now=now)
            return "published"
        except asyncio.CancelledError:
            logger.warning("Publishing cancelled for post %s", post.id)
            self._revert_on_cancellation(session=session, post=post)
            raise
        except Exception as exc:
            logger.error("Unexpected error publishing post %s: %s", post.id, exc)
            status_code = getattr(exc, "status_code", None)
            failure = FailureDetail(
                status_code=status_code,
                error_message=str(exc),
                now=now,
            )
            return self._handle_failure(session=session, post=post, failure=failure)

    async def process_due_posts(
        self,
        *,
        session: Session,
        redis_client: Any | None = None,
        owner_id: uuid.UUID | None = None,
        limit: int = 100,
    ) -> dict[str, int]:
        """Poll and execute due scheduled posts under a distributed lock."""
        summary = {
            "processed": 0,
            "published": 0,
            "failed": 0,
            "retried": 0,
            "skipped": 0,
            "recovered": 0,
        }
        current_time = datetime.now(timezone.utc)
        lock = RedisDistributedLock(redis_client=redis_client)

        with lock as acquired:
            if not acquired:
                logger.info("Scheduler execution skipped: lock held by another process")
                summary["skipped"] = 1
                return summary

            recovered = self.recover_stale_posts(session=session, now=current_time)
            summary["recovered"] = recovered

            due_posts = self.get_due_posts(
                session=session, now=current_time, owner_id=owner_id, limit=limit
            )
            for post in due_posts:
                if not lock.is_held():
                    logger.warning("Distributed lock lost mid-batch; stopping cycle")
                    summary["skipped"] += 1
                    break

                lock.renew()
                summary["processed"] += 1
                try:
                    result = await self._process_single_post(
                        session=session, post=post, now=current_time
                    )
                    if result in summary:
                        summary[result] += 1
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    session.rollback()
                    logger.error(
                        "Failed processing post %s; rolled back: %s", post.id, exc
                    )
                    summary["failed"] += 1

        return summary


async def run_scheduler_background_loop(
    *,
    poll_interval_seconds: int = 30,
    redis_client: Any | None = None,
) -> None:
    """Periodic background polling loop that runs within the FastAPI event loop."""
    logger.info(
        "Scheduler background loop started (poll interval: %ds)", poll_interval_seconds
    )
    from app.core.db import engine

    scheduler = SchedulerService()
    batch_limit = 100

    while True:
        has_more_backlog = False
        try:
            with Session(engine) as session:
                summary = await scheduler.process_due_posts(
                    session=session, redis_client=redis_client, limit=batch_limit
                )
                has_more_backlog = summary.get("processed", 0) >= batch_limit
        except asyncio.CancelledError:
            logger.info(
                "Scheduler background loop received cancellation; exiting cleanly"
            )
            break
        except Exception as exc:
            logger.error("Error in scheduler background polling cycle: %s", exc)

        try:
            sleep_duration = 0.05 if has_more_backlog else float(poll_interval_seconds)
            await asyncio.sleep(sleep_duration)
        except asyncio.CancelledError:
            logger.info(
                "Scheduler background loop cancelled during sleep; exiting cleanly"
            )
            break
