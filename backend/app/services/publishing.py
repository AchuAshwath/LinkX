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


def _linkedin_account_for_persona(
    *, session: Session, persona_id: uuid.UUID
) -> SocialAccount | None:
    statement = select(SocialAccount).where(
        SocialAccount.persona_id == persona_id,
        SocialAccount.platform == "linkedin",
    )
    return session.exec(statement).first()


def _handle_publish_error(
    *, session: Session, post: Post, user_id: uuid.UUID, err: Exception
) -> PublishFailure:
    validate_transition(current_status=post.status, target_status="failed")
    post.status = "failed"

    if hasattr(err, "code") and hasattr(err, "detail") and hasattr(err, "retryable"):
        code = err.code
        detail = str(err.detail)
        retryable = err.retryable
        details = getattr(err, "details", {})
        trace_id = getattr(err, "trace_id", str(uuid.uuid4()))
        status_code = getattr(err, "status_code", 500)
    else:
        code = "internal_error"
        detail = f"Unexpected system error: {err}"
        retryable = False
        details = {}
        trace_id = str(uuid.uuid4())
        status_code = 500

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
        "publish_failed post_id=%s persona_id=%s user_id=%s status=%s trace_id=%s code=%s retryable=%s",
        post.id,
        post.persona_id,
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


async def publish_post(
    *,
    session: Session,
    post: Post,
    user_id: uuid.UUID,
) -> PublishFailure | None:
    if post.persona_id is None:
        failure = LinkedInPostError(
            status_code=400,
            detail="persona_id is required",
            code="persona_required",
            retryable=False,
            details={"platform": "linkedin"},
        )
        return _handle_publish_error(
            session=session, post=post, user_id=user_id, err=failure
        )

    if post.external_post_id:
        if post.status != "published":
            validate_transition(current_status=post.status, target_status="published")
            post.status = "published"
            post.published_at = post.published_at or _now_utc()
            post.error_code = None
            post.error_message = None
            post.next_retry_at = None
            post.updated_at = _now_utc()
            session.add(post)
            session.commit()
            session.refresh(post)
        return None

    validate_transition(current_status=post.status, target_status="publishing")
    post.status = "publishing"
    post.publishing_started_at = _now_utc()
    post.updated_at = _now_utc()
    session.add(post)
    session.commit()
    session.refresh(post)

    if post.platform == "linkedin":
        linkedin_account = _linkedin_account_for_persona(
            session=session,
            persona_id=post.persona_id,
        )
        if not linkedin_account or not linkedin_account.external_user_id:
            err = LinkedInPostError(
                status_code=400,
                detail="LinkedIn account not connected for this persona",
                code="linkedin_not_connected",
                retryable=False,
                details={"platform": "linkedin"},
            )
            return _handle_publish_error(
                session=session, post=post, user_id=user_id, err=err
            )

        try:
            client = LinkedInPostClient()
            external_post_id = await client.create_text_post(
                persona_id=str(post.persona_id),
                linkedin_person_id=linkedin_account.external_user_id,
                content=post.content,
            )
        except Exception as err:
            return _handle_publish_error(
                session=session, post=post, user_id=user_id, err=err
            )
    elif post.platform == "x":
        try:
            x_client = XPostClient()
            external_post_id = await x_client.create_text_post(
                persona_id=str(post.persona_id),
                content=post.content,
            )
        except Exception as err:
            return _handle_publish_error(
                session=session, post=post, user_id=user_id, err=err
            )
    else:
        raise ValueError(f"Unsupported platform: {post.platform}")

    validate_transition(current_status=post.status, target_status="published")
    post.status = "published"
    post.external_post_id = external_post_id
    post.published_at = _now_utc()
    post.error_code = None
    post.error_message = None
    post.next_retry_at = None
    post.updated_at = _now_utc()
    session.add(post)
    session.commit()
    session.refresh(post)
    logger.info(
        "publish_success post_id=%s persona_id=%s user_id=%s status=%s",
        post.id,
        post.persona_id,
        user_id,
        post.status,
    )
    return None
