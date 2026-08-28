"""LangGraph node execution handlers for PostingGraph."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from langgraph.graph import END

from app import crud
from app.services.agentic.posting_dispatch import (
    dispatch_dual_post,
    dispatch_linkedin_post,
    dispatch_x_post,
    parse_dual_channel_results,
    update_db_post_publish_state,
)
from app.services.agentic.posting_preflight import (
    build_post_record,
    extract_published_urls,
    handle_published_preflight,
    transition_post_to_publishing,
    validate_preflight_accounts,
)
from app.services.agentic.schemas import PostingGraphState
from app.services.agentic.tools.common import resolve_session
from app.services.agentic.verification_graph import verify_posts_with_graph

logger = logging.getLogger(__name__)

__all__ = [
    "dispatch_publish_node",
    "preflight_check_node",
    "record_publish_results_node",
    "route_after_preflight",
    "verify_published_post_node",
]


async def preflight_check_node(
    state: PostingGraphState,
) -> dict[str, Any]:
    """Validate target post, accounts, image attachments, and initial state."""
    user_id = state.get("user_id", "")
    post_id = state.get("post_id", "")
    platform_override = state.get("platform")

    try:
        user_uuid = uuid.UUID(user_id)
        post_uuid = uuid.UUID(post_id)
    except (ValueError, TypeError):
        return {
            "status": "preflight_failed",
            "error": f"Invalid user_id ({user_id}) or post_id ({post_id})",
        }

    with resolve_session(session=state.get("session")) as s:
        db_post = crud.get_post(session=s, post_id=post_uuid)
        if not db_post:
            return {
                "status": "preflight_failed",
                "error": f"Post not found with ID: {post_id}",
            }

        if db_post.owner_id != user_uuid:
            return {
                "status": "preflight_failed",
                "error": "Post ownership validation failed",
            }

        target_platform = (platform_override or db_post.platform).lower().strip()

        if db_post.status == "published":
            return handle_published_preflight(db_post=db_post, platform=target_platform)

        ok, acc_err = validate_preflight_accounts(
            user_id=user_id, platform=target_platform, session=s
        )
        if not ok:
            return {"status": "preflight_failed", "error": acc_err}

        trans_err = transition_post_to_publishing(db_post=db_post, session=s)
        if trans_err:
            return {"status": "preflight_failed", "error": trans_err}

        post_record = build_post_record(post=db_post, platform=target_platform)

    return {
        "platform": target_platform,
        "post_record": post_record,
        "status": "preflight_passed",
    }


async def dispatch_publish_node(
    state: PostingGraphState,
) -> dict[str, Any]:
    """Route publishing to platform dispatchers."""
    post_id = state.get("post_id", "")
    platform = state.get("platform", "x").lower().strip()
    headless = state.get("headless", True)

    with resolve_session(session=state.get("session")) as s:
        db_post = crud.get_post(session=s, post_id=uuid.UUID(post_id))
        if not db_post:
            return {"status": "error", "error": f"Post not found: {post_id}"}

        if platform in ("x", "twitter"):
            ok, ext_id, err = await dispatch_x_post(
                session=s, post=db_post, headless=headless
            )
            x_res = {"success": ok, "post_id": ext_id, "error": err}
            li_res = None
        elif platform == "linkedin":
            ok, ext_id, err = await dispatch_linkedin_post(session=s, post=db_post)
            li_res = {"success": ok, "post_id": ext_id, "error": err}
            x_res = None
        else:
            ok, ext_id, err = await dispatch_dual_post(
                session=s, post=db_post, headless=headless
            )
            x_res, li_res = parse_dual_channel_results(ext_id=ext_id, err=err)

        urls = extract_published_urls(platform=platform, ext_id=ext_id)

    if not ok:
        status = "partial_failure" if ext_id else "error"
    else:
        status = "dispatched"

    return {
        "x_result": x_res,
        "linkedin_result": li_res,
        "external_post_id": ext_id,
        "published_urls": urls,
        "status": status,
        "error": err,
    }


async def verify_published_post_node(
    state: PostingGraphState,
) -> dict[str, Any]:
    """Execute embedded VerificationGraph against live published post."""
    user_id = state.get("user_id", "")
    post_id = state.get("post_id", "")
    platform = state.get("platform", "x")
    ext_id = state.get("external_post_id")
    mouse = state.get("mouse")
    prev_status = state.get("status", "")

    if not ext_id:
        return {
            "is_verified": False,
            "verification_report": None,
            "status": prev_status,
        }

    try:
        verify_report = await verify_posts_with_graph(
            user_id=user_id,
            post_ids=[post_id],
            platform=platform,
            session=state.get("session"),
            mouse=mouse,
        )
        is_verified = post_id in verify_report.verified_post_ids
        return {
            "is_verified": is_verified,
            "verification_report": verify_report.model_dump(),
            "status": prev_status,
        }
    except Exception as exc:
        logger.warning(f"Embedded verification failed for post {post_id}: {exc}")
        return {
            "is_verified": False,
            "verification_report": None,
            "status": prev_status,
        }


async def record_publish_results_node(
    state: PostingGraphState,
) -> dict[str, Any]:
    """Update post status in PostgreSQL and finalize report."""
    post_id = state.get("post_id", "")
    ext_id = state.get("external_post_id")
    status = state.get("status", "")
    err = state.get("error")

    with resolve_session(session=state.get("session")) as s:
        db_post = crud.get_post(session=s, post_id=uuid.UUID(post_id))
        if not db_post:
            return {"status": "error", "error": f"Post not found: {post_id}"}

        final_status = update_db_post_publish_state(
            session=s,
            db_post=db_post,
            status=status,
            ext_id=ext_id,
            err=err,
        )

    return {"status": final_status}


def route_after_preflight(state: PostingGraphState) -> str:
    """Determine whether to proceed with publishing or abort."""
    status = state.get("status")
    if status == "preflight_failed":
        return END
    if status == "published":
        return "verify_published_post"
    return "dispatch_publish"
