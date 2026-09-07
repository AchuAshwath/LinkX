"""LangGraph StateGraph for orchestrating end-to-end X.com trends scraping and persistence."""

from __future__ import annotations

import logging
from typing import Any, TypedDict

from langchain_core.callbacks.manager import adispatch_custom_event
from langgraph.graph import END, START, StateGraph

from app.services.agentic.schemas import ScrapedBatchReport
from app.services.agentic.scraping_extraction import (
    _execute_trends_extraction,
    _extract_timelines_for_candidates,
    _format_single_topic,
    _get_topic_url,
    _load_selectors,
    _parse_clamped_max_topics,
    _parse_single_tweet,
    _try_navigate_to_trends,
)
from app.services.agentic.scraping_persistence import (
    _execute_batch_persistence,
    _resolve_user_id,
    _safe_int,
)
from app.services.agentic.scraping_session import (
    _check_session_and_page_state,
    _diagnose_and_recover_overlay,
    _diagnose_page_health,
    _is_valid_page,
    _validate_user_session,
    _verify_session_exists,
)
from app.services.agentic.session_recovery_graph import (
    _detect_overlay,
    recover_page_session,
)
from app.services.agentic.tools.common import get_active_page
from app.services.browser.actions import EvasionMouse, human_navigation, random_delay
from app.services.browser.diagnostics import detect_page_state, extract_grok_summary
from app.services.browser.manager import BrowserManager
from scripts.scrape_trending_topics import (
    extract_topic_tweets,
    extract_trending_sidebar,
    navigate_to_trends,
)

logger = logging.getLogger(__name__)

__all__ = [
    "ScrapingGraphState",
    "build_scraping_graph",
    "scrape_trends_with_graph",
    "init_and_recover_session_node",
    "scrape_explore_trends_node",
    "extract_topic_timelines_node",
    "persist_scraped_batch_node",
    "_route_after_session_check",
    "_load_selectors",
    "_parse_clamped_max_topics",
    "_format_single_topic",
    "_parse_single_tweet",
    "_try_navigate_to_trends",
    "_get_topic_url",
    "_diagnose_and_recover_overlay",
    "_diagnose_page_health",
    "_is_valid_page",
    "_validate_user_session",
    "_verify_session_exists",
    "_detect_overlay",
    "recover_page_session",
    "get_active_page",
    "BrowserManager",
    "detect_page_state",
    "extract_grok_summary",
    "extract_topic_tweets",
    "extract_trending_sidebar",
    "navigate_to_trends",
    "human_navigation",
    "random_delay",
    "EvasionMouse",
    "_safe_int",
    "_resolve_user_id",
]


class ScrapingGraphState(TypedDict, total=False):
    # Inputs
    user_id: str
    max_topics: int
    headless: bool
    session: Any
    # Browser & Recovery
    page: Any
    mouse: Any
    browser_context: Any
    page_state: str
    session_recovery: dict[str, Any] | None
    # Extraction
    scraped_topics: list[dict[str, Any]]
    topic_tweets_map: dict[str, list[dict[str, Any]]]
    topic_summaries: dict[str, str]
    failed_topics: list[dict[str, str]]
    # Persistence
    persisted_topic_count: int
    persisted_tweet_count: int
    # Control
    status: str
    error: str | None


async def _safe_dispatch_node_event(event_name: str, data: dict[str, Any]) -> None:
    """Safely dispatch LangGraph custom event to parent stream runner."""
    try:
        await adispatch_custom_event(event_name, data)
    except Exception:
        pass


async def init_and_recover_session_node(state: ScrapingGraphState) -> dict[str, Any]:
    """Verify stored session exists, detect page state, and auto-recover overlays."""
    raw_user_id = state.get("user_id")
    user_id = str(raw_user_id).strip() if raw_user_id else "default"
    page = state.get("page")
    mouse = state.get("mouse")

    await _safe_dispatch_node_event(
        "scraping_node_start",
        {
            "name": "init_and_recover_session",
            "input": {"user_id": user_id, "platform": "x"},
        },
    )

    try:
        (
            page_state,
            status,
            session_recovery,
            error,
        ) = await _check_session_and_page_state(
            user_id=user_id or "default", page=page, mouse=mouse
        )
        out = {
            "page_state": page_state,
            "session_recovery": session_recovery,
            "status": status,
            "error": error,
        }
    except Exception as e:
        logger.error(f"Unexpected error in init_and_recover_session_node: {e}")
        out = {
            "page_state": "error",
            "status": "unrecoverable",
            "error": str(e),
        }

    await _safe_dispatch_node_event(
        "scraping_node_end",
        {"name": "init_and_recover_session", "output": out},
    )
    return out


async def scrape_explore_trends_node(state: ScrapingGraphState) -> dict[str, Any]:
    """Navigate to explore/trends and extract trending topic blocks."""
    max_topics = _parse_clamped_max_topics(val=state.get("max_topics"), default=3)
    await _safe_dispatch_node_event(
        "scraping_node_start",
        {
            "name": "scrape_explore_trends",
            "input": {"target": "x.com/explore/tabs/keyword", "max_topics": max_topics},
        },
    )

    page = state.get("page")
    if page is None:
        no_page_out: dict[str, Any] = {
            "scraped_topics": [],
            "status": "error",
            "error": "No page instance available for scraping",
        }
        await _safe_dispatch_node_event(
            "scraping_node_end",
            {"name": "scrape_explore_trends", "output": no_page_out},
        )
        return no_page_out

    try:
        res = await _execute_trends_extraction(page=page)
    except Exception as e:
        logger.error(f"Error during scrape_explore_trends_node: {e}")
        res = {
            "scraped_topics": [],
            "status": "error",
            "error": str(e),
        }

    end_payload = (
        {
            "topics_count": len(res.get("scraped_topics", [])),
            "scraped_topics": res.get("scraped_topics", []),
            "status": "trends_extracted",
        }
        if res.get("status") == "trends_extracted"
        else res
    )
    await _safe_dispatch_node_event(
        "scraping_node_end",
        {"name": "scrape_explore_trends", "output": end_payload},
    )
    return res


async def _handle_empty_timelines() -> dict[str, Any]:
    """Emit skip events and return empty state when no topics or page present."""
    out: dict[str, Any] = {
        "topic_tweets_map": {},
        "topic_summaries": {},
        "failed_topics": [],
        "status": "tweets_extracted",
    }
    await _safe_dispatch_node_event(
        "scraping_node_start",
        {"name": "extract_topic_timelines", "input": {"topics_to_extract": 0}},
    )
    await _safe_dispatch_node_event(
        "scraping_node_end",
        {
            "name": "extract_topic_timelines",
            "output": {"status": "skipped", "reason": "No topics or page"},
        },
    )
    return out


async def _dispatch_timelines_complete(
    *,
    summaries: dict[str, str],
    tweets_map: dict[str, list[dict[str, Any]]],
    failed: list[dict[str, str]],
) -> None:
    """Emit timeline extraction completion custom event."""
    await _safe_dispatch_node_event(
        "scraping_node_end",
        {
            "name": "extract_topic_timelines",
            "output": {
                "summaries_count": len(summaries),
                "tweets_extracted_count": sum(len(v) for v in tweets_map.values()),
                "failed_topics_count": len(failed),
                "status": "tweets_extracted",
            },
        },
    )


async def extract_topic_timelines_node(state: ScrapingGraphState) -> dict[str, Any]:
    """For top N trending topics, navigate to timeline, extract tweets and Grok summary."""
    page = state.get("page")
    mouse = state.get("mouse")
    scraped_topics_raw = state.get("scraped_topics", [])
    scraped_topics = scraped_topics_raw if isinstance(scraped_topics_raw, list) else []
    max_topics = _parse_clamped_max_topics(val=state.get("max_topics"), default=3)

    if not scraped_topics or page is None:
        return await _handle_empty_timelines()

    candidates = list(scraped_topics)
    selected_topics = candidates[:max_topics]
    selected_titles = [
        str(t.get("topic_title", "")) for t in selected_topics if isinstance(t, dict)
    ]

    await _safe_dispatch_node_event(
        "scraping_node_start",
        {
            "name": "extract_topic_timelines",
            "input": {
                "topics_to_extract": len(selected_topics),
                "topics": selected_titles,
            },
        },
    )

    selectors = _load_selectors()
    (
        topic_tweets_map,
        topic_summaries,
        failed_topics,
    ) = await _extract_timelines_for_candidates(
        page=page,
        selected_topics=selected_topics,
        selectors=selectors,
        mouse=mouse,
    )

    await _dispatch_timelines_complete(
        summaries=topic_summaries,
        tweets_map=topic_tweets_map,
        failed=failed_topics,
    )

    return {
        "topic_tweets_map": topic_tweets_map,
        "topic_summaries": topic_summaries,
        "failed_topics": failed_topics,
        "status": "tweets_extracted",
    }


async def persist_scraped_batch_node(state: ScrapingGraphState) -> dict[str, Any]:
    """Persist scraped topics and tweets into PostgreSQL via CRUD upsert."""
    scraped_topics_raw = state.get("scraped_topics", [])
    scraped_topics = scraped_topics_raw if isinstance(scraped_topics_raw, list) else []

    await _safe_dispatch_node_event(
        "scraping_node_start",
        {
            "name": "persist_scraped_batch",
            "input": {
                "topics_to_persist": len(scraped_topics),
                "user_id": str(state.get("user_id", "default")),
            },
        },
    )

    if not scraped_topics:
        out = {
            "persisted_topic_count": 0,
            "persisted_tweet_count": 0,
            "status": "persisted",
        }
        await _safe_dispatch_node_event(
            "scraping_node_end",
            {"name": "persist_scraped_batch", "output": out},
        )
        return out

    out = _execute_batch_persistence(state=state)
    await _safe_dispatch_node_event(
        "scraping_node_end",
        {"name": "persist_scraped_batch", "output": out},
    )
    return out


def _route_after_session_check(state: ScrapingGraphState) -> str:
    """Route after session initialization & recovery: abort if unrecoverable."""
    if (
        state.get("page_state") in ("logged_out", "captcha")
        or state.get("status") == "unrecoverable"
    ):
        return END
    return "scrape_explore_trends"


def _route_after_trends_scraped(state: ScrapingGraphState) -> str:
    """Route after explore scraping: abort if error or no topics scraped."""
    if state.get("status") in ("error", "unrecoverable") or not state.get(
        "scraped_topics"
    ):
        return END
    return "extract_topic_timelines"


def build_scraping_graph() -> Any:
    """Compile LangGraph StateGraph for trending topics scraping and extraction."""
    workflow = StateGraph(ScrapingGraphState)
    workflow.add_node("init_and_recover_session", init_and_recover_session_node)
    workflow.add_node("scrape_explore_trends", scrape_explore_trends_node)
    workflow.add_node("extract_topic_timelines", extract_topic_timelines_node)
    workflow.add_node("persist_scraped_batch", persist_scraped_batch_node)

    workflow.add_edge(START, "init_and_recover_session")
    workflow.add_conditional_edges(
        "init_and_recover_session",
        _route_after_session_check,
        {
            END: END,
            "scrape_explore_trends": "scrape_explore_trends",
        },
    )
    workflow.add_conditional_edges(
        "scrape_explore_trends",
        _route_after_trends_scraped,
        {
            END: END,
            "extract_topic_timelines": "extract_topic_timelines",
        },
    )
    workflow.add_edge("extract_topic_timelines", "persist_scraped_batch")
    workflow.add_edge("persist_scraped_batch", END)
    return workflow.compile()


_scraping_graph = build_scraping_graph()


def _make_abort_scraped_batch_report(
    *, page_state: str, error: str
) -> ScrapedBatchReport:
    """Construct an unrecoverable or error report when browser setup fails."""
    return ScrapedBatchReport(
        scraped_topics=[],
        topic_tweets_map={},
        topic_summaries={},
        failed_topics=[],
        persisted_topic_count=0,
        persisted_tweet_count=0,
        page_state=page_state,
        session_recovery=None,
        status="unrecoverable" if page_state in ("logged_out", "captcha") else "error",
        error=error,
    )


def _resolve_report_status(*, raw_status: Any, error: Any, persisted_count: int) -> str:
    if error and persisted_count == 0:
        return str(raw_status) if raw_status in ("error", "unrecoverable") else "error"
    return str(raw_status or "persisted")


def _format_scraped_batch_report(*, final_state: dict[str, Any]) -> ScrapedBatchReport:
    """Format and validate final ScrapedBatchReport from completed graph state."""
    raw_status = final_state.get("status")
    error = final_state.get("error")
    persisted_count = int(final_state.get("persisted_topic_count", 0))
    status = _resolve_report_status(
        raw_status=raw_status, error=error, persisted_count=persisted_count
    )

    return ScrapedBatchReport(
        scraped_topics=final_state.get("scraped_topics", []),
        topic_tweets_map=final_state.get("topic_tweets_map", {}),
        topic_summaries=final_state.get("topic_summaries", {}),
        failed_topics=final_state.get("failed_topics", []),
        persisted_topic_count=persisted_count,
        persisted_tweet_count=int(final_state.get("persisted_tweet_count", 0)),
        page_state=final_state.get("page_state", "ok"),
        session_recovery=final_state.get("session_recovery"),
        status=status,
        error=error,
    )


async def scrape_trends_with_graph(
    *,
    user_id: str,
    max_topics: int = 3,
    headless: bool = True,
    **kwargs: Any,
) -> ScrapedBatchReport:
    """Run the ScrapingGraph to harvest, extract, and persist trending topics from X."""
    thread_id = kwargs.get("thread_id")
    session = kwargs.get("session")
    config = kwargs.get("config")

    clamped_max_topics = _parse_clamped_max_topics(val=max_topics, default=3)
    run_config: dict[str, Any] = config.copy() if config else {}
    if thread_id:
        run_config.setdefault("configurable", {})["thread_id"] = thread_id

    sanitized_user_id = str(user_id).strip() if user_id else "default"
    if not sanitized_user_id:
        sanitized_user_id = "default"

    try:
        manager = BrowserManager(user_id=sanitized_user_id)
        if not manager.session_exists("x"):
            return _make_abort_scraped_batch_report(
                page_state="logged_out", error="No stored X.com session found"
            )
    except Exception as e:
        logger.warning(f"BrowserManager initialization error: {e}")
        return _make_abort_scraped_batch_report(
            page_state="error", error=f"Browser session check failed: {e}"
        )

    try:
        async with manager.get_context("x", headless=headless) as context:
            page = await get_active_page(context=context)
            mouse = None
            if hasattr(page, "mouse") and hasattr(page, "viewport_size"):
                try:
                    mouse = EvasionMouse(page)
                    await mouse.start_idle()
                except Exception as m_err:
                    logger.debug(f"Could not start idle mouse: {m_err}")

            initial_state: ScrapingGraphState = {
                "user_id": sanitized_user_id,
                "max_topics": clamped_max_topics,
                "headless": headless,
                "session": session,
                "page": page,
                "mouse": mouse,
                "browser_context": context,
                "page_state": "unknown",
                "session_recovery": None,
                "scraped_topics": [],
                "topic_tweets_map": {},
                "topic_summaries": {},
                "failed_topics": [],
                "persisted_topic_count": 0,
                "persisted_tweet_count": 0,
                "status": "pending",
                "error": None,
            }

            try:
                final_state = await _scraping_graph.ainvoke(
                    initial_state, config=run_config if run_config else None
                )
            finally:
                if mouse is not None:
                    try:
                        await mouse.stop_idle()
                    except Exception:
                        pass

            return _format_scraped_batch_report(final_state=final_state)

    except Exception as e:
        logger.error(f"Error during scrape_trends_with_graph execution: {e}")
        return _make_abort_scraped_batch_report(page_state="error", error=str(e))
