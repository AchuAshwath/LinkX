"""Autonomous Publish-and-Verify Composite Pipeline orchestrating PostingGraph and VerificationGraph."""

from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, START, StateGraph

from app.services.agentic.posting_graph import publish_post_with_graph
from app.services.agentic.schemas import (
    PostingGraphReport,
    PublishAndVerifyReport,
    PublishAndVerifyState,
    VerificationGraphReport,
)
from app.services.agentic.verification_graph import verify_posts_with_graph

logger = logging.getLogger(__name__)

__all__ = [
    "PublishAndVerifyState",
    "audit_verification_node",
    "build_publish_and_verify_pipeline",
    "dispatch_publication_node",
    "route_after_publish",
    "run_publish_and_verify_pipeline",
]


async def dispatch_publication_node(
    state: PublishAndVerifyState,
) -> dict[str, Any]:
    """Execute multi-channel dispatch via PostingGraph."""
    user_id = state.get("user_id", "")
    post_id = state.get("post_id", "")
    platform = state.get("platform")
    headless = state.get("headless", True)
    session = state.get("session")
    mouse = state.get("mouse")

    try:
        post_rep = await publish_post_with_graph(
            user_id=user_id,
            post_id=post_id,
            platform=platform,
            headless=headless,
            session=session,
            mouse=mouse,
        )
        is_pub = post_rep.status in ("published", "completed")
        return {
            "posting_report": post_rep.model_dump(),
            "published_urls": post_rep.published_urls,
            "is_published": is_pub,
            "is_verified": post_rep.is_verified,
            "status": "published" if is_pub else "posting_failed",
            "error": post_rep.error,
        }
    except Exception as exc:
        logger.exception(f"Publication dispatch failed: {exc}")
        return {
            "is_published": False,
            "is_verified": False,
            "status": "error",
            "error": str(exc),
        }


def route_after_publish(state: PublishAndVerifyState) -> str:
    """Determine whether to proceed with profile audit or abort on posting rejection."""
    if not state.get("is_published") or state.get("status") in (
        "posting_failed",
        "error",
    ):
        return END
    return "audit_verification"


async def audit_verification_node(
    state: PublishAndVerifyState,
) -> dict[str, Any]:
    """Audit live profile timeline via VerificationGraph if not already confirmed."""
    if state.get("is_verified"):
        return {"status": "completed"}

    user_id = state.get("user_id", "")
    post_id = state.get("post_id", "")
    platform = state.get("platform") or "x"
    headless = state.get("headless", True)
    session = state.get("session")
    mouse = state.get("mouse")

    try:
        audit_rep = await verify_posts_with_graph(
            user_id=user_id,
            post_ids=[post_id],
            platform=platform,
            headless=headless,
            session=session,
            mouse=mouse,
        )
        is_ver = post_id in audit_rep.verified_post_ids
        status = "completed" if is_ver else "partial_failure"
        return {
            "verification_report": audit_rep.model_dump(),
            "is_verified": is_ver,
            "status": status,
        }
    except Exception as exc:
        logger.warning(f"Verification audit failed: {exc}")
        return {
            "is_verified": False,
            "status": "partial_failure",
            "error": str(exc),
        }


def build_publish_and_verify_pipeline() -> Any:
    """Construct and compile the AutonomousPublishAndVerify composite pipeline StateGraph."""
    workflow = StateGraph(PublishAndVerifyState)
    workflow.add_node("dispatch_publication", dispatch_publication_node)
    workflow.add_node("audit_verification", audit_verification_node)

    workflow.add_edge(START, "dispatch_publication")
    workflow.add_conditional_edges(
        "dispatch_publication",
        route_after_publish,
        {
            END: END,
            "audit_verification": "audit_verification",
        },
    )
    workflow.add_edge("audit_verification", END)
    return workflow.compile()


_publish_and_verify_pipeline = build_publish_and_verify_pipeline()


async def run_publish_and_verify_pipeline(
    *,
    user_id: str,
    post_id: str,
    platform: str | None = None,
    **kwargs: Any,
) -> PublishAndVerifyReport:
    """Execute multi-channel publishing with automated ground-truth profile verification."""
    headless: bool = kwargs.get("headless", True)
    session: Any = kwargs.get("session")
    mouse: Any | None = kwargs.get("mouse")
    config: dict[str, Any] | None = kwargs.get("config")

    initial_state: PublishAndVerifyState = {
        "user_id": user_id.strip(),
        "post_id": post_id.strip(),
        "platform": (platform or "both").lower().strip(),
        "headless": headless,
        "session": session,
        "mouse": mouse,
        "posting_report": None,
        "verification_report": None,
        "is_published": False,
        "is_verified": False,
        "published_urls": [],
        "status": "initializing",
        "error": None,
    }

    try:
        final_state = await _publish_and_verify_pipeline.ainvoke(
            initial_state, config=dict(config or {})
        )
        post_rep_raw = final_state.get("posting_report")
        ver_rep_raw = final_state.get("verification_report")

        post_rep = (
            PostingGraphReport.model_validate(post_rep_raw) if post_rep_raw else None
        )
        ver_rep = (
            VerificationGraphReport.model_validate(ver_rep_raw) if ver_rep_raw else None
        )

        return PublishAndVerifyReport(
            post_id=post_id,
            platform=final_state.get("platform", platform or "both"),
            is_published=final_state.get("is_published", False),
            is_verified=final_state.get("is_verified", False),
            published_urls=final_state.get("published_urls", []),
            posting_report=post_rep,
            verification_report=ver_rep,
            status=final_state.get("status", "completed"),
            error=final_state.get("error"),
        )
    except Exception as exc:
        logger.exception(f"PublishAndVerify pipeline execution failed: {exc}")
        return PublishAndVerifyReport(
            post_id=post_id,
            platform=platform or "both",
            status="error",
            error=str(exc),
        )
