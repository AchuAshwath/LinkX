"""VerificationGraph: Ground-Truth Social Media Verification & Telemetry Auditor."""

from __future__ import annotations

import logging
import uuid
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from sqlmodel import Session

from app.services.agentic.schemas import (
    VerificationGraphReport,
    VerificationItemReport,
)
from app.services.agentic.tools.common import resolve_session
from app.services.agentic.verification_matching import (
    format_canonical_post_url,
    match_post_on_timeline,
    probe_url_reachability,
)
from app.services.agentic.verification_scraper import scrape_x_profile_feed
from app.services.agentic.verification_storage import load_target_posts_from_db

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


class VerificationGraphState(TypedDict, total=False):
    """Execution state for VerificationGraph orchestrator."""

    user_id: str
    post_ids: list[str]
    platform: str
    headless: bool
    max_tweets_to_check: int
    session: Any
    mouse: Any
    target_posts: list[dict[str, Any]]
    timeline_tweets: list[dict[str, Any]]
    items: list[dict[str, Any]]
    verified_ids: list[str]
    unverified_ids: list[str]
    reachability_status: dict[str, bool]
    status: str
    error: str | None


async def fetch_unverified_posts_node(
    state: VerificationGraphState,
) -> dict[str, Any]:
    """Retrieve post records from database that require verification."""
    user_id = state.get("user_id", "")
    post_ids = state.get("post_ids", [])
    platform = state.get("platform", "x")

    try:
        user_uuid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        return {
            "status": "error",
            "error": f"Invalid user_id provided: {user_id}",
        }

    with resolve_session(session=state.get("session")) as s:
        target_posts = load_target_posts_from_db(
            session=s,
            user_uuid=user_uuid,
            post_ids=post_ids,
            platform=platform,
        )

    if post_ids and not target_posts:
        return {
            "target_posts": [],
            "items": [],
            "verified_ids": [],
            "unverified_ids": post_ids,
            "reachability_status": {},
            "status": "error",
            "error": "No valid target posts found for the provided IDs",
        }

    return {
        "target_posts": target_posts,
        "items": [],
        "verified_ids": [],
        "unverified_ids": [],
        "reachability_status": {},
        "status": "posts_fetched",
    }


async def scrape_x_profile_timeline_node(
    state: VerificationGraphState,
) -> dict[str, Any]:
    """Scrape live X.com profile timeline if verifying X posts."""
    platform = state.get("platform", "x").lower().strip()
    target_posts = state.get("target_posts", [])

    has_x_post = platform in ("x", "both", "all", "twitter") or any(
        str(p.get("platform") or "x") in ("x", "both", "all", "linkx")
        for p in target_posts
    )

    if not has_x_post:
        return {"timeline_tweets": [], "status": "timeline_skipped"}

    user_id = state.get("user_id", "")
    max_tweets = state.get("max_tweets_to_check", 5)
    mouse = state.get("mouse")
    headless = state.get("headless", True)
    ext_ids = [
        str(p.get("external_post_id"))
        for p in target_posts
        if p.get("external_post_id")
    ]

    timeline_tweets = await scrape_x_profile_feed(
        user_id=user_id,
        max_tweets=max_tweets,
        mouse=mouse,
        headless=headless,
        target_ext_ids=ext_ids,
    )
    return {"timeline_tweets": timeline_tweets, "status": "timeline_scraped"}


def _verify_single_x_post(
    *, post: dict[str, Any], timeline_tweets: list[dict[str, Any]]
) -> VerificationItemReport:
    """Perform ground-truth verification on an X post."""
    post_id = str(post.get("id") or "")
    content = str(post.get("content") or "")
    ext_id = post.get("external_post_id")

    is_match, matched_text, matched_id, conf = match_post_on_timeline(
        expected_content=content,
        expected_ext_id=ext_id,
        timeline_tweets=timeline_tweets,
    )

    live_url = format_canonical_post_url(platform="x", ext_id=matched_id or ext_id)

    return VerificationItemReport(
        post_id=post_id,
        platform="x",
        is_verified=is_match,
        external_post_id=matched_id or ext_id,
        matched_text=matched_text,
        match_confidence=conf,
        live_url=live_url,
        status_code=200 if is_match else 404,
        error=None if is_match else "Post not found on live profile timeline",
    )


def _verify_single_linkedin_post(*, post: dict[str, Any]) -> VerificationItemReport:
    """Verify a LinkedIn post by URN presence and format."""
    post_id = str(post.get("id") or "")
    ext_id = post.get("external_post_id")

    is_valid_urn = bool(ext_id and ("urn:li:" in ext_id or ext_id.isdigit()))
    live_url = format_canonical_post_url(platform="linkedin", ext_id=ext_id)

    return VerificationItemReport(
        post_id=post_id,
        platform="linkedin",
        is_verified=is_valid_urn,
        external_post_id=ext_id,
        matched_text=post.get("content"),
        match_confidence=1.0 if is_valid_urn else 0.0,
        live_url=live_url,
        status_code=200 if is_valid_urn else 400,
        error=None if is_valid_urn else "Invalid or missing LinkedIn URN",
    )


def _evaluate_target_post(
    *, post: dict[str, Any], timeline_tweets: list[dict[str, Any]]
) -> list[VerificationItemReport]:
    """Evaluate a single target post across its configured platforms."""
    platform = str(post.get("platform") or "x").lower().strip()
    if platform in ("both", "all", "linkx"):
        return [
            _verify_single_linkedin_post(post=post),
            _verify_single_x_post(post=post, timeline_tweets=timeline_tweets),
        ]
    if platform == "linkedin":
        return [_verify_single_linkedin_post(post=post)]
    return [_verify_single_x_post(post=post, timeline_tweets=timeline_tweets)]


async def match_and_verify_posts_node(
    state: VerificationGraphState,
) -> dict[str, Any]:
    """Evaluate target posts against scraped timeline and platform URNs."""
    target_posts = state.get("target_posts", [])
    timeline_tweets = state.get("timeline_tweets", [])

    items: list[dict[str, Any]] = []
    verified_ids: list[str] = []
    unverified_ids: list[str] = []

    for post in target_posts:
        post_id = str(post.get("id") or "")
        reports = _evaluate_target_post(post=post, timeline_tweets=timeline_tweets)
        for r in reports:
            items.append(r.model_dump())

        if any(r.is_verified for r in reports):
            verified_ids.append(post_id)
        else:
            unverified_ids.append(post_id)

    return {
        "items": items,
        "verified_ids": list(dict.fromkeys(verified_ids)),
        "unverified_ids": list(dict.fromkeys(unverified_ids)),
        "status": "posts_verified",
    }


async def probe_urls_node(
    state: VerificationGraphState,
) -> dict[str, Any]:
    """Execute live HTTP reachability probes on canonical post URLs."""
    items = state.get("items", [])
    reachability_status: dict[str, bool] = {}
    updated_items: list[dict[str, Any]] = []

    for raw_item in items:
        item = VerificationItemReport.model_validate(raw_item)
        if item.live_url:
            is_reachable, code, probe_err = await probe_url_reachability(
                url=item.live_url
            )
            reachability_status[item.live_url] = is_reachable
            item.status_code = code
            if not is_reachable and not item.error:
                item.error = probe_err
        updated_items.append(item.model_dump())

    return {
        "items": updated_items,
        "reachability_status": reachability_status,
        "status": "urls_probed",
    }


async def record_audit_results_node(
    state: VerificationGraphState,
) -> dict[str, Any]:
    """Finalize verification audit report state."""
    prev_status = state.get("status", "")
    if prev_status == "error":
        return {"status": "error"}

    verified_ids = state.get("verified_ids", [])
    unverified_ids = state.get("unverified_ids", [])

    if not verified_ids and unverified_ids:
        status = "partial"
    else:
        status = "completed"

    return {"status": status}


def _route_after_fetch(state: VerificationGraphState) -> str:
    """Route to scraping or abort to END on fetch error."""
    if state.get("status") == "error":
        return END
    return "scrape_x_profile_timeline"


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
        _route_after_fetch,
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
    headless: bool = True,
    max_tweets_to_check: int = 5,
    session: Session | None = None,
    mouse: Any | None = None,
    config: dict[str, Any] | None = None,
) -> VerificationGraphReport:
    """Run the VerificationGraph to audit and verify ground-truth live posts."""
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
