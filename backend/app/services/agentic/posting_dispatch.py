"""Platform-specific publishing dispatchers for PostingGraph."""

from __future__ import annotations

import logging
from typing import Any

from sqlmodel import Session

from app.models import Post
from app.services.publishing import (
    PublishFailure,
    _handle_publish_error,
    _mark_as_published,
    _publish_linkedin,
    _publish_x,
)

logger = logging.getLogger(__name__)


async def dispatch_x_post(
    *, session: Session, post: Post, headless: bool = True
) -> tuple[bool, str | None, str | None]:
    """Execute live post publishing to X.com via stealth browser automation."""
    try:
        res = await _publish_x(session=session, post=post, headless=headless)
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
    *, session: Session, post: Post, headless: bool = True
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

    x_ok, x_id, x_err = await dispatch_x_post(
        session=session, post=post, headless=headless
    )
    if not x_ok:
        combined_id = f"linkedin:{li_id}"
        return (
            False,
            combined_id,
            f"LinkedIn published ({li_id}), but X failed: {x_err}",
        )

    combined_id = f"linkedin:{li_id},x:{x_id}"
    return True, combined_id, None


def _extract_channel_id(*, ext_id: str | None, prefix: str) -> str | None:
    """Extract individual platform post ID from combined ID string."""
    if not ext_id or prefix not in ext_id:
        return None
    part = ext_id.split(prefix)[1].split(",")[0].strip()
    return part if part else None


def parse_dual_channel_results(
    *, ext_id: str | None, err: str | None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Decompose combined external ID into per-channel result dicts."""
    li_id = _extract_channel_id(ext_id=ext_id, prefix="linkedin:")
    x_id = _extract_channel_id(ext_id=ext_id, prefix="x:")

    li_res = {
        "success": bool(li_id),
        "post_id": li_id,
        "error": None if li_id else err,
    }
    x_res = {
        "success": bool(x_id),
        "post_id": x_id,
        "error": None if x_id else err,
    }
    return x_res, li_res


def update_db_post_publish_state(
    *,
    session: Session,
    db_post: Post,
    status: str,
    ext_id: str | None,
    err: str | None,
) -> str:
    """Update post in PostgreSQL based on dispatch status and return final status."""
    if status == "partial_failure" and ext_id:
        _mark_as_published(session=session, post=db_post, external_post_id=ext_id)
        return "partial_failure"

    if ext_id and status in ("dispatched", "preflight_passed", "published"):
        if db_post.status != "published":
            _mark_as_published(session=session, post=db_post, external_post_id=ext_id)
        return "published"

    if db_post.status == "published":
        return "published"

    _handle_publish_error(
        session=session,
        post=db_post,
        err=RuntimeError(err or "Publishing failed"),
    )
    return "failed"
