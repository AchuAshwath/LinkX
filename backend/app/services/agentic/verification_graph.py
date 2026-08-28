"""VerificationGraph: Ground-Truth Social Media Verification & Telemetry Auditor."""

from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, START, StateGraph
from sqlmodel import Session

from app.services.agentic.schemas import (
    VerificationGraphReport,
    VerificationGraphState,
    VerificationItemReport,
)
from app.services.agentic.verification_nodes import (
    fetch_unverified_posts_node,
    match_and_verify_posts_node,
    probe_urls_node,
    record_audit_results_node,
    route_after_fetch,
    scrape_x_profile_timeline_node,
)

logger = logging.getLogger(__name__)

__all__ = [
    "VerificationGraphState",
    "build_verification_graph",
    "verify_posts_with_graph",
    "fetch_unverified_posts_node",
    "scrape_x_profile_timeline_node",
    "match_and_verify_posts_node",
    "probe_urls_node",
    "record_audit_results_node",
    "_route_after_fetch",
]

_route_after_fetch = route_after_fetch


def build_verification_graph() -> Any:
    """Construct and compile the VerificationGraph state machine."""
    workflow = StateGraph(VerificationGraphState)
    workflow.add_node("fetch_unverified_posts", fetch_unverified_posts_node)
    workflow.add_node("scrape_x_profile_timeline", scrape_x_profile_timeline_node)
    workflow.add_node("match_and_verify_posts", match_and_verify_posts_node)
    workflow.add_node("probe_urls", probe_urls_node)
    workflow.add_node("record_audit_results", record_audit_results_node)

    workflow.add_edge(START, "fetch_unverified_posts")
    workflow.add_conditional_edges(
        "fetch_unverified_posts",
        route_after_fetch,
        {
            END: END,
            "scrape_x_profile_timeline": "scrape_x_profile_timeline",
        },
    )
    workflow.add_edge("scrape_x_profile_timeline", "match_and_verify_posts")
    workflow.add_edge("match_and_verify_posts", "probe_urls")
    workflow.add_edge("probe_urls", "record_audit_results")
    workflow.add_edge("record_audit_results", END)
    return workflow.compile()


_verification_graph = build_verification_graph()


async def verify_posts_with_graph(
    *,
    user_id: str,
    post_ids: list[str] | None = None,
    platform: str = "x",
    **kwargs: Any,
) -> VerificationGraphReport:
    """Run the VerificationGraph to audit and verify ground-truth live posts."""
    headless: bool = kwargs.get("headless", True)
    max_tweets_to_check: int = kwargs.get("max_tweets_to_check", 5)
    session: Session | None = kwargs.get("session")
    mouse: Any | None = kwargs.get("mouse")
    config: dict[str, Any] | None = kwargs.get("config")

    initial_state: VerificationGraphState = {
        "user_id": user_id.strip(),
        "post_ids": post_ids or [],
        "platform": platform.lower().strip(),
        "headless": headless,
        "max_tweets_to_check": max(1, min(max_tweets_to_check, 20)),
        "session": session,
        "mouse": mouse,
        "target_posts": [],
        "timeline_tweets": [],
        "items": [],
        "verified_ids": [],
        "unverified_ids": [],
        "reachability_status": {},
        "status": "initializing",
        "error": None,
    }

    run_config = dict(config or {})

    try:
        final_state: dict[str, Any] = await _verification_graph.ainvoke(
            initial_state, config=run_config
        )
        return VerificationGraphReport(
            verified_post_ids=final_state.get("verified_ids", []),
            unverified_post_ids=final_state.get("unverified_ids", []),
            items=[
                VerificationItemReport.model_validate(it)
                for it in final_state.get("items", [])
            ],
            platform=final_state.get("platform", platform),
            reachability_status=final_state.get("reachability_status", {}),
            status=final_state.get("status", "completed"),
            error=final_state.get("error"),
        )
    except Exception as exc:
        logger.exception(f"VerificationGraph failed with exception: {exc}")
        return VerificationGraphReport(
            verified_post_ids=[],
            unverified_post_ids=post_ids or [],
            items=[],
            platform=platform,
            reachability_status={},
            status="error",
            error=str(exc),
        )
