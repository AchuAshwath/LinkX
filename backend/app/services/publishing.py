from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from app.models import Post, PublishErrorResponse, SocialAccount
from app.services.linkedin_posts import LinkedInPostClient, LinkedInPostError
from app.services.post_state_machine import validate_transition
from app.services.x_posts import XPostClient

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
BASE_RETRY_SECONDS = 60


@dataclass
class PublishFailure:
    status_code: int
    payload: PublishErrorResponse


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _next_retry_time(*, retry_count: int) -> datetime:
    delay_seconds = BASE_RETRY_SECONDS * (2 ** max(retry_count - 1, 0))
    return _now_utc() + timedelta(seconds=delay_seconds)


def _linkedin_account_for_user(
    *, session: Session, user_id: uuid.UUID
) -> SocialAccount | None:
    statement = select(SocialAccount).where(
        SocialAccount.user_id == user_id,
        SocialAccount.platform == "linkedin",
    )
    return session.exec(statement).first()


def _handle_publish_error(
    *, session: Session, post: Post, user_id: uuid.UUID, err: Exception
) -> PublishFailure:
    validate_transition(current_status=post.status, target_status="failed")
    post.status = "failed"

    # Use duck-typing to extract structured error fields if available
    is_structured = hasattr(err, "code") and hasattr(err, "detail")

    code = getattr(err, "code", "internal_error") if is_structured else "internal_error"
    detail = str(getattr(err, "detail", f"Unexpected system error: {err}"))
    retryable = getattr(err, "retryable", False) if is_structured else False
    details = getattr(err, "details", {}) if is_structured else {}
    trace_id = getattr(err, "trace_id", str(uuid.uuid4()))
    status_code = getattr(err, "status_code", 500) if is_structured else 500

    post.error_code = code
    post.error_message = detail

    if retryable and post.retry_count < MAX_RETRIES:
        post.retry_count += 1
        post.last_retry_at = _now_utc()
        post.next_retry_at = _next_retry_time(retry_count=post.retry_count)
    else:
        post.next_retry_at = None

    post.updated_at = _now_utc()
    session.add(post)
    session.commit()
    session.refresh(post)

    logger.warning(
        "publish_failed post_id=%s user_id=%s status=%s trace_id=%s code=%s retryable=%s",
        post.id,
        user_id,
        post.status,
        trace_id,
        code,
        retryable,
    )

    return PublishFailure(
        status_code=status_code,
        payload=PublishErrorResponse(
            error=code,
            message=detail,
            retryable=retryable,
            details=details,
            trace_id=trace_id,
        ),
    )


async def _publish_linkedin(
    session: Session, post: Post, user_id: uuid.UUID
) -> str | PublishFailure:
    linkedin_account = _linkedin_account_for_user(
        session=session,
        user_id=post.owner_id,
    )
    if not linkedin_account or not linkedin_account.external_user_id:
        err = LinkedInPostError(
            status_code=400,
            detail="LinkedIn account not connected for this user",
            code="linkedin_not_connected",
            retryable=False,
            details={"platform": "linkedin"},
        )
        return _handle_publish_error(
            session=session, post=post, user_id=user_id, err=err
        )

    try:
        client = LinkedInPostClient()
        return await client.create_text_post(
            user_id=str(post.owner_id),
            linkedin_person_id=linkedin_account.external_user_id,
            content=post.content,
        )
    except Exception as err:
        return _handle_publish_error(
            session=session, post=post, user_id=user_id, err=err
        )


async def _publish_x(
    session: Session, post: Post, user_id: uuid.UUID
) -> str | PublishFailure:
    try:
        x_client = XPostClient()
        return await x_client.create_text_post(
            user_id=str(post.owner_id),
            content=post.content,
        )
    except Exception as err:
        return _handle_publish_error(
            session=session, post=post, user_id=user_id, err=err
        )


_PLATFORM_PUBLISHERS = {
    "linkedin": _publish_linkedin,
    "x": _publish_x,
}


async def _publish_to_platform(
    session: Session, post: Post, user_id: uuid.UUID
) -> str | PublishFailure:
    publisher = _PLATFORM_PUBLISHERS.get(post.platform)
    if not publisher:
        err = ValueError(f"Unsupported platform: {post.platform}")
        return _handle_publish_error(
            session=session, post=post, user_id=user_id, err=err
        )
    return await publisher(session, post, user_id)


def _mark_as_published(session: Session, post: Post, external_post_id: str) -> None:
    validate_transition(current_status=post.status, target_status="published")
    post.status = "published"
    post.external_post_id = external_post_id
    post.published_at = post.published_at or _now_utc()
    post.error_code = None
    post.error_message = None
    post.next_retry_at = None
    post.updated_at = _now_utc()
    session.add(post)
    session.commit()
    session.refresh(post)


async def publish_post(
    *,
    session: Session,
    post: Post,
    user_id: uuid.UUID,
) -> PublishFailure | None:
    if post.external_post_id:
        if post.status == "published":
            return None
        _mark_as_published(session, post, post.external_post_id)
        return None

    validate_transition(current_status=post.status, target_status="publishing")
    post.status = "publishing"
    post.publishing_started_at = _now_utc()
    post.updated_at = _now_utc()
    session.add(post)
    session.commit()
    session.refresh(post)

    result = await _publish_to_platform(session, post, user_id)
    if isinstance(result, PublishFailure):
        return result

    _mark_as_published(session, post, result)
    logger.info(
        "publish_success post_id=%s user_id=%s status=%s",
        post.id,
        user_id,
        post.status,
    )
    return None
