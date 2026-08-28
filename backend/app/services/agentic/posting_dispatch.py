"""Platform-specific publishing dispatchers for PostingGraph."""

from __future__ import annotations

import logging

from sqlmodel import Session

from app.models import Post
from app.services.publishing import (
    PublishFailure,
    _publish_linkedin,
    _publish_x,
)

logger = logging.getLogger(__name__)


async def dispatch_x_post(
    *, session: Session, post: Post
) -> tuple[bool, str | None, str | None]:
    """Execute live post publishing to X.com via stealth browser automation."""
    try:
        res = await _publish_x(session=session, post=post)
        if isinstance(res, PublishFailure):
            return False, None, res.payload.message
        return True, str(res), None
    except Exception as exc:
        logger.exception(f"X publishing failed: {exc}")
        return False, None, str(exc)


async def dispatch_linkedin_post(
    *, session: Session, post: Post
) -> tuple[bool, str | None, str | None]:
    """Execute live post publishing to LinkedIn via official REST API."""
    try:
        res = await _publish_linkedin(session=session, post=post)
        if isinstance(res, PublishFailure):
            return False, None, res.payload.message
        return True, str(res), None
    except Exception as exc:
        logger.exception(f"LinkedIn publishing failed: {exc}")
        return False, None, str(exc)


async def dispatch_dual_post(
    *, session: Session, post: Post
) -> tuple[bool, str | None, str | None]:
    """Execute sequential dual-channel publishing across LinkedIn and X."""
    li_ok, li_id, li_err = await dispatch_linkedin_post(session=session, post=post)
    if not li_ok:
        return False, None, f"LinkedIn failed: {li_err}"

    # Checkpoint LinkedIn post URN in database
    post.external_post_id = f"linkedin:{li_id}"
    session.add(post)
    session.commit()
    session.refresh(post)

    x_ok, x_id, x_err = await dispatch_x_post(session=session, post=post)
    if not x_ok:
        combined_id = f"linkedin:{li_id}"
        return (
            False,
            combined_id,
            f"LinkedIn published ({li_id}), but X failed: {x_err}",
        )

    combined_id = f"linkedin:{li_id},x:{x_id}"
    return True, combined_id, None
