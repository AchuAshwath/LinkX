"""LangGraph node execution handlers for VerificationGraph."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from langgraph.graph import END

from app.services.agentic.schemas import (
    VerificationGraphState,
    VerificationItemReport,
)
from app.services.agentic.tools.common import resolve_session
from app.services.agentic.verification_matching import (
    evaluate_target_post,
    probe_url_reachability,
)
from app.services.agentic.verification_scraper import scrape_x_profile_feed
from app.services.agentic.verification_storage import load_target_posts_from_db

logger = logging.getLogger(__name__)

__all__ = [
    "fetch_unverified_posts_node",
    "match_and_verify_posts_node",
    "probe_urls_node",
    "record_audit_results_node",
    "route_after_fetch",
    "scrape_x_profile_timeline_node",
]


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
        reports = evaluate_target_post(post=post, timeline_tweets=timeline_tweets)
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


def route_after_fetch(state: VerificationGraphState) -> str:
    """Route to scraping or abort to END on fetch error."""
    if state.get("status") == "error":
        return END
    return "scrape_x_profile_timeline"
