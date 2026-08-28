"""PostingGraph: Multi-Channel Autonomous Publishing Orchestrator with Embedded Verification."""

from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, START, StateGraph
from sqlmodel import Session

from app.services.agentic.posting_nodes import (
    dispatch_publish_node,
    preflight_check_node,
    record_publish_results_node,
    route_after_preflight,
    verify_published_post_node,
)
from app.services.agentic.schemas import PostingGraphReport, PostingGraphState

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
]

_route_after_preflight = route_after_preflight


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
        route_after_preflight,
        {
            END: END,
            "dispatch_publish": "dispatch_publish",
            "verify_published_post": "verify_published_post",
        },
    )
    workflow.add_edge("dispatch_publish", "verify_published_post")
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
