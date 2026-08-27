"""LangGraph StateGraph orchestrator for topic curation, drafting, refinement, and persistence."""

from __future__ import annotations

import copy
import logging
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.services.agentic.refinement_graph import refine_draft_with_graph
from app.services.agentic.schemas import CuratedDraftReport
from app.services.agentic.tools.context_tools import (
    get_recent_post_history,
    get_social_account_status,
    get_topic_tweets_and_summary,
)
from app.services.agentic.tools.curation_tools import draft_social_post
from app.services.agentic.tools.persistence_tools import save_draft_post

logger = logging.getLogger(__name__)


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


def _sanitize_platform(platform: Any) -> str:
    """Normalize and validate target social platform string."""
    cleaned = _sanitize_string(platform, max_length=50, default="x").lower()
    return cleaned if cleaned else "x"


class CurationGraphState(TypedDict, total=False):
    # Inputs
    user_id: str
    topic_id: str | None
    topic_title: str
    platform: str
    target_tone: str | None
    session: Any
    # Context
    topic_summary: str | None
    sample_tweets: list[dict[str, Any]]
    recent_posts: list[dict[str, Any]]
    is_premium: bool
    # Drafting
    draft_content: str | None
    # Refinement
    refined_content: str | None
    is_compliant: bool
    compliance_report: dict[str, Any] | None
    refinement_attempts: int
    # Persistence
    persisted_post_id: str | None
    # Control
    status: str
    error: str | None


async def gather_context_node(state: CurationGraphState) -> dict[str, Any]:
    """Gather topic summary, sample tweets, post history, and account tier."""
    user_id = _sanitize_string(state.get("user_id"), max_length=128)
    topic_id = state.get("topic_id")
    platform = _sanitize_platform(state.get("platform"))
    session = state.get("session")

    topic_summary: str | None = None
    sample_tweets: list[dict[str, Any]] = []
    recent_posts: list[dict[str, Any]] = []
    is_premium = False

    try:
        # 1. Topic context (if topic_id provided)
        if topic_id:
            try:
                clean_topic_id = _sanitize_string(topic_id, max_length=128)
                topic_ctx = get_topic_tweets_and_summary(
                    topic_id=clean_topic_id, session=session
                )
                if topic_ctx:
                    topic_summary = getattr(topic_ctx, "summary", None)
                    raw_tweets = getattr(topic_ctx, "sample_tweets", []) or []
                    sample_tweets = [
                        t if isinstance(t, dict) else {"text": str(t)}
                        for t in raw_tweets
                        if t is not None
                    ]
            except Exception as e:
                logger.warning(f"Error fetching topic context for {topic_id}: {e}")

        # 2. Recent post history
        try:
            history = get_recent_post_history(
                user_id=user_id, platform=platform, limit=3, session=session
            )
            for p in history or []:
                if p is None:
                    continue
                if hasattr(p, "model_dump"):
                    recent_posts.append(p.model_dump())
                elif isinstance(p, dict):
                    recent_posts.append(p)
                else:
                    recent_posts.append({"content": str(p)})
        except Exception as e:
            logger.warning(f"Error fetching recent post history for {user_id}: {e}")

        # 3. Social account status
        try:
            status_report = get_social_account_status(user_id=user_id, session=session)
            if status_report:
                if hasattr(status_report, "x_is_premium"):
                    is_premium = bool(status_report.x_is_premium)
                elif isinstance(status_report, dict):
                    is_premium = bool(status_report.get("x_is_premium", False))
        except Exception as e:
            logger.warning(f"Error fetching account status for {user_id}: {e}")

        return {
            "topic_summary": topic_summary,
            "sample_tweets": sample_tweets,
            "recent_posts": recent_posts,
            "is_premium": is_premium,
            "status": "context_gathered",
        }
    except Exception as e:
        logger.error(f"Error in gather_context_node: {e}")
        return {
            "topic_summary": None,
            "sample_tweets": [],
            "recent_posts": [],
            "is_premium": False,
            "status": "context_gathered",
            "error": str(e),
        }


async def draft_content_node(state: CurationGraphState) -> dict[str, Any]:
    """Generate initial social media post draft tailored to topic and platform."""
    raw_title = state.get("topic_title", "")
    topic_title = _sanitize_string(raw_title, max_length=5000, default="Trending Topic")
    topic_summary = state.get("topic_summary")
    platform = _sanitize_platform(state.get("platform"))
    target_tone = state.get("target_tone")
    if target_tone is not None:
        target_tone = _sanitize_string(target_tone, max_length=500)
        if not target_tone:
            target_tone = None

    fallback_draft = f"Trending: {topic_title}"

    try:
        draft = await draft_social_post(
            topic_title=topic_title,
            topic_summary=topic_summary,
            platform=platform,
            tone=target_tone,
        )
        clean_draft = _sanitize_string(draft, default=fallback_draft)
        return {
            "draft_content": clean_draft,
            "status": "drafted",
        }
    except Exception as e:
        logger.error(f"Error in draft_content_node: {e}")
        return {
            "draft_content": fallback_draft,
            "status": "drafted",
            "error": str(e),
        }


async def refine_copy_node(state: CurationGraphState) -> dict[str, Any]:
    """Refine post draft using refinement subgraph against platform constraints."""
    raw_title = state.get("topic_title", "")
    topic_title = _sanitize_string(raw_title, max_length=5000, default="Trending Topic")
    fallback_content = f"Trending: {topic_title}"

    draft_content = _sanitize_string(
        state.get("draft_content"),
        default=fallback_content,
    )
    platform = _sanitize_platform(state.get("platform"))
    is_premium = bool(state.get("is_premium", False))
    target_tone = state.get("target_tone")
    if target_tone is not None:
        target_tone = _sanitize_string(target_tone, max_length=500)
        if not target_tone:
            target_tone = None

    try:
        report = await refine_draft_with_graph(
            content=draft_content,
            platform=platform,
            is_premium=is_premium,
            target_tone=target_tone,
        )
        raw_refined = getattr(report, "refined_content", None)
        refined_content = _sanitize_string(raw_refined, default=draft_content)
        is_compliant = bool(getattr(report, "is_compliant", False))
        compliance_report = getattr(report, "compliance_report", None)
        attempts = int(getattr(report, "attempts", 0))
        status = (
            "refined" if getattr(report, "status", None) != "error" else "best_effort"
        )

        return {
            "refined_content": refined_content,
            "is_compliant": is_compliant,
            "compliance_report": compliance_report,
            "refinement_attempts": attempts,
            "status": status,
        }
    except Exception as e:
        logger.error(f"Error in refine_copy_node: {e}")
        return {
            "refined_content": draft_content,
            "is_compliant": False,
            "compliance_report": None,
            "refinement_attempts": 0,
            "status": "error",
            "error": str(e),
        }


async def persist_draft_node(state: CurationGraphState) -> dict[str, Any]:
    """Save the finalized draft post to PostgreSQL with method='agent'."""
    user_id = _sanitize_string(state.get("user_id"), max_length=128)
    raw_title = state.get("topic_title", "")
    topic_title = _sanitize_string(raw_title, max_length=5000, default="Trending Topic")
    fallback_content = f"Trending: {topic_title}"

    platform = _sanitize_platform(state.get("platform"))
    session = state.get("session")
    refined_content = state.get("refined_content")
    draft_content = state.get("draft_content")

    target_content = _sanitize_string(
        refined_content or draft_content,
        max_length=25000,
        default=fallback_content,
    )

    try:
        post = save_draft_post(
            user_id=user_id,
            content=target_content,
            platform=platform,
            session=session,
        )
        if post is not None and getattr(post, "id", None) is not None:
            return {
                "persisted_post_id": str(post.id),
                "status": "persisted",
            }
        else:
            return {
                "persisted_post_id": None,
                "status": "error",
                "error": "Failed to persist draft to database",
            }
    except Exception as e:
        logger.error(f"Error in persist_draft_node: {e}")
        return {
            "persisted_post_id": None,
            "status": "error",
            "error": f"Failed to persist draft to database: {e}",
        }


def build_curation_graph() -> Any:
    """Compile linear StateGraph for full curation, drafting, refinement, and persistence."""
    workflow = StateGraph(CurationGraphState)
    workflow.add_node("gather_context", gather_context_node)
    workflow.add_node("draft_content", draft_content_node)
    workflow.add_node("refine_copy", refine_copy_node)
    workflow.add_node("persist_draft", persist_draft_node)

    workflow.add_edge(START, "gather_context")
    workflow.add_edge("gather_context", "draft_content")
    workflow.add_edge("draft_content", "refine_copy")
    workflow.add_edge("refine_copy", "persist_draft")
    workflow.add_edge("persist_draft", END)
    return workflow.compile()


_curation_graph = build_curation_graph()


async def curate_and_draft_post(
    *,
    user_id: str,
    topic_title: str,
    topic_id: str | None = None,
    platform: str = "x",
    target_tone: str | None = None,
    thread_id: str | None = None,
    session: Any = None,
    config: dict[str, Any] | None = None,
) -> CuratedDraftReport:
    """Run the CurationGraph to produce, refine, and persist a platform-optimized social draft."""
    clean_user_id = _sanitize_string(user_id, max_length=128)
    clean_topic_title = _sanitize_string(
        topic_title, max_length=5000, default="Trending Topic"
    )
    clean_topic_id = (
        _sanitize_string(topic_id, max_length=128) if topic_id is not None else None
    )
    if clean_topic_id == "":
        clean_topic_id = None

    norm_platform = _sanitize_platform(platform)
    clean_target_tone = (
        _sanitize_string(target_tone, max_length=500)
        if target_tone is not None
        else None
    )
    if clean_target_tone == "":
        clean_target_tone = None

    initial_state: CurationGraphState = {
        "user_id": clean_user_id,
        "topic_id": clean_topic_id,
        "topic_title": clean_topic_title,
        "platform": norm_platform,
        "target_tone": clean_target_tone,
        "session": session,
        "topic_summary": None,
        "sample_tweets": [],
        "recent_posts": [],
        "is_premium": False,
        "draft_content": None,
        "refined_content": None,
        "is_compliant": False,
        "compliance_report": None,
        "refinement_attempts": 0,
        "persisted_post_id": None,
        "status": "pending",
        "error": None,
    }

    # Deep copy config to prevent race conditions across concurrent executions
    run_config: dict[str, Any] = copy.deepcopy(config) if config else {}
    if thread_id is not None:
        configurable = dict(run_config.get("configurable") or {})
        configurable["thread_id"] = str(thread_id)
        run_config["configurable"] = configurable

    fallback_content = f"Trending: {clean_topic_title}"

    try:
        final_state = await _curation_graph.ainvoke(
            initial_state,
            config=run_config if run_config else None,
        )
        raw_draft = final_state.get("draft_content")
        draft_content = _sanitize_string(raw_draft, default=fallback_content)

        raw_refined = final_state.get("refined_content")
        refined_content = _sanitize_string(raw_refined, default=draft_content)

        is_compliant = bool(final_state.get("is_compliant", False))
        refinement_attempts = int(final_state.get("refinement_attempts", 0))
        persisted_post_id = final_state.get("persisted_post_id")
        compliance_report = final_state.get("compliance_report")
        status = final_state.get("status", "persisted")
        error = final_state.get("error")

        return CuratedDraftReport(
            draft_content=draft_content,
            refined_content=refined_content,
            is_compliant=is_compliant,
            platform=norm_platform,
            topic_title=clean_topic_title,
            topic_summary=final_state.get("topic_summary"),
            refinement_attempts=refinement_attempts,
            persisted_post_id=persisted_post_id,
            compliance_report=compliance_report,
            status=status,
            error=error,
        )
    except Exception as e:
        logger.error(f"Error during CurationGraph execution: {e}")
        return CuratedDraftReport(
            draft_content=fallback_content,
            refined_content=fallback_content,
            is_compliant=False,
            platform=norm_platform,
            topic_title=clean_topic_title,
            topic_summary=None,
            refinement_attempts=0,
            persisted_post_id=None,
            compliance_report=None,
            status="error",
            error=str(e),
        )
