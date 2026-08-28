"""PostingGraph: Multi-Channel Autonomous Publishing Orchestrator with Embedded Verification."""

from __future__ import annotations

import logging
import uuid
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from sqlmodel import Session

from app import crud
from app.models import Post
from app.services.agentic.posting_dispatch import (
    dispatch_dual_post,
    dispatch_linkedin_post,
    dispatch_x_post,
)
from app.services.agentic.posting_preflight import (
    build_post_record,
    extract_published_urls,
    handle_published_preflight,
    transition_post_to_publishing,
    validate_preflight_accounts,
)
from app.services.agentic.schemas import PostingGraphReport
from app.services.agentic.tools.common import resolve_session
from app.services.agentic.verification_graph import verify_posts_with_graph
from app.services.publishing import (
    _handle_publish_error,
    _mark_as_published,
)

logger = logging.getLogger(__name__)

__all__ = [
    "PostingGraphState",
    "build_posting_graph",
    "publish_post_with_graph",
    "preflight_check_node",
    "dispatch_publish_node",
    "verify_published_post_node",
    "record_publish_results_node",
    "_route_after_preflight",
    "_route_after_dispatch",
]


def _sanitize_string(
    val: Any,
    *,
    max_length: int | None = None,
    default: str = "",
) -> str:
    """Sanitize input string by stripping null bytes, whitespace, and bounding length."""
    if val is None:
        return default
    cleaned = str(val).replace("\x00", "").strip()
    if not cleaned:
        return default
    if max_length is not None and len(cleaned) > max_length:
        return cleaned[:max_length]
    return cleaned


class PostingGraphState(TypedDict, total=False):
    """Execution state for PostingGraph orchestrator."""

    user_id: str
    post_id: str
    platform: str
    headless: bool
    session: Any
    mouse: Any
    post_record: dict[str, Any] | None
    x_result: dict[str, Any] | None
    linkedin_result: dict[str, Any] | None
    published_urls: list[str]
    is_verified: bool
    verification_report: dict[str, Any] | None
    external_post_id: str | None
    status: str
    error: str | None


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


def _extract_channel_id(*, ext_id: str | None, prefix: str) -> str | None:
    """Extract individual platform post ID from combined ID string."""
    if not ext_id or prefix not in ext_id:
        return None
    part = ext_id.split(prefix)[1].split(",")[0].strip()
    return part if part else None


def _parse_dual_channel_results(
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
            x_res, li_res = _parse_dual_channel_results(ext_id=ext_id, err=err)

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


def _update_db_post_publish_state(
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

        final_status = _update_db_post_publish_state(
            session=s,
            db_post=db_post,
            status=status,
            ext_id=ext_id,
            err=err,
        )

    return {"status": final_status}


def _route_after_preflight(state: PostingGraphState) -> str:
    """Branch to dispatch, verification, or abort to END on preflight failure."""
    status = state.get("status")
    if status == "preflight_failed":
        return END
    if status == "published":
        return "verify_published_post"
    return "dispatch_publish"


def _route_after_dispatch(state: PostingGraphState) -> str:
    """Branch to verification or failure recording."""
    if state.get("status") == "error":
        return "record_publish_results"
    return "verify_published_post"


def build_posting_graph() -> Any:
    """Construct and compile the PostingGraph state machine."""
    workflow = StateGraph(PostingGraphState)
    workflow.add_node("preflight_check", preflight_check_node)
    workflow.add_node("dispatch_publish", dispatch_publish_node)
    workflow.add_node("verify_published_post", verify_published_post_node)
    workflow.add_node("record_publish_results", record_publish_results_node)

    workflow.add_edge(START, "preflight_check")
    workflow.add_conditional_edges(
        "preflight_check",
        _route_after_preflight,
        {
            END: END,
            "dispatch_publish": "dispatch_publish",
            "verify_published_post": "verify_published_post",
        },
    )
    workflow.add_conditional_edges(
        "dispatch_publish",
        _route_after_dispatch,
        {
            "record_publish_results": "record_publish_results",
            "verify_published_post": "verify_published_post",
        },
    )
    workflow.add_edge("verify_published_post", "record_publish_results")
    workflow.add_edge("record_publish_results", END)
    return workflow.compile()


_posting_graph = build_posting_graph()


async def publish_post_with_graph(
    *,
    user_id: str,
    post_id: str,
    platform: str | None = None,
    headless: bool = True,
    session: Session | None = None,
    mouse: Any | None = None,
    config: dict[str, Any] | None = None,
) -> PostingGraphReport:
    """Run the PostingGraph to execute multi-channel publishing with embedded verification."""
    initial_state: PostingGraphState = {
        "user_id": user_id.strip(),
        "post_id": post_id.strip(),
        "platform": (platform or "x").lower().strip(),
        "headless": headless,
        "session": session,
        "mouse": mouse,
        "post_record": None,
        "x_result": None,
        "linkedin_result": None,
        "published_urls": [],
        "is_verified": False,
        "verification_report": None,
        "external_post_id": None,
        "status": "initializing",
        "error": None,
    }

    run_config = dict(config or {})

    try:
        final_state: dict[str, Any] = await _posting_graph.ainvoke(
            initial_state, config=run_config
        )
        post_rec = final_state.get("post_record") or {}
        content = post_rec.get("content", "")

        return PostingGraphReport(
            post_id=post_id,
            platform=final_state.get("platform", platform or "x"),
            content=content,
            x_result=final_state.get("x_result"),
            linkedin_result=final_state.get("linkedin_result"),
            published_urls=final_state.get("published_urls", []),
            is_verified=final_state.get("is_verified", False),
            verification_report=final_state.get("verification_report"),
            status=final_state.get("status", "published"),
            error=final_state.get("error"),
        )
    except Exception as exc:
        logger.exception(f"PostingGraph failed with exception: {exc}")
        return PostingGraphReport(
            post_id=post_id,
            platform=platform or "x",
            content="",
            status="error",
            error=str(exc),
        )
