"""Preflight validation and state transitions for PostingGraph."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session

from app.models import Post
from app.services.agentic.tools.context_tools import get_social_account_status
from app.services.agentic.verification_matching import format_canonical_post_url
from app.services.post_state_machine import validate_transition
from app.services.publishing import resolve_image_path

__all__ = [
    "build_post_record",
    "handle_published_preflight",
    "transition_post_to_publishing",
    "validate_preflight_accounts",
    "extract_published_urls",
]


def extract_published_urls(*, platform: str, ext_id: str | None) -> list[str]:
    """Parse canonical live URLs from platform external ID."""
    if not ext_id:
        return []
    chunks = ext_id.split(",") if "," in ext_id else [ext_id]
    urls: list[str] = []
    for chunk in chunks:
        u = format_canonical_post_url(platform=platform, ext_id=chunk.strip())
        if u:
            urls.append(u)
    return urls


def validate_preflight_accounts(
    *, user_id: str, platform: str, session: Session
) -> tuple[bool, str | None]:
    """Verify target platforms are connected for the user."""
    status_report = get_social_account_status(user_id=user_id, session=session)
    clean_platform = platform.lower().strip()

    if clean_platform in ("x", "twitter") and not status_report.x_connected:
        return False, "X (Twitter) account is not connected or session missing"

    if clean_platform == "linkedin" and not status_report.linkedin_connected:
        return False, "LinkedIn account is not connected"

    if clean_platform in ("both", "all", "linkx"):
        if not status_report.x_connected and not status_report.linkedin_connected:
            return False, "Neither X nor LinkedIn accounts are connected"

    return True, None


def build_post_record(*, post: Post, platform: str) -> dict[str, Any]:
    """Serialize Post model into a clean dict for graph state."""
    return {
        "id": str(post.id),
        "content": post.content,
        "platform": platform,
        "image_url": post.image_url,
        "status": post.status,
    }


def handle_published_preflight(*, db_post: Post, platform: str) -> dict[str, Any]:
    """Return idempotent report for already published post."""
    urls = extract_published_urls(platform=platform, ext_id=db_post.external_post_id)
    return {
        "platform": platform,
        "post_record": build_post_record(post=db_post, platform=platform),
        "external_post_id": db_post.external_post_id,
        "published_urls": urls,
        "status": "published",
    }


def transition_post_to_publishing(*, db_post: Post, session: Session) -> str | None:
    """Transition post status to 'publishing' with state validation."""
    if db_post.image_url:
        image_path = resolve_image_path(image_url=db_post.image_url)
        if not image_path.exists():
            return f"Attached image file not found: {image_path}"

    try:
        validate_transition(current_status=db_post.status, target_status="publishing")
        db_post.status = "publishing"
        db_post.publishing_started_at = datetime.now(timezone.utc)
        try:
            session.add(db_post)
            session.commit()
            session.refresh(db_post)
        except Exception:
            pass
        return None
    except Exception as exc:
        return f"State transition error: {exc}"
