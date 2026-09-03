"""LangGraph StateGraph for orchestrating end-to-end X.com trends scraping and persistence."""

from __future__ import annotations

import logging
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.services.agentic.schemas import ScrapedBatchReport
from app.services.agentic.scraping_extraction import (
    _format_single_topic,
    _get_topic_url,
    _load_selectors,
    _parse_clamped_max_topics,
    _parse_single_tweet,
    _try_navigate_to_trends,
)
from app.services.agentic.scraping_persistence import (
    _resolve_user_id,
    _safe_int,
    persist_scraped_batch_records,
)
from app.services.agentic.scraping_session import (
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


async def _perform_session_recovery(
    *, page: Any, mouse: Any | None = None
) -> tuple[str, str, dict[str, Any] | None, str | None]:
    """Execute session recovery using module-scoped recover_page_session."""
    try:
        recovery = await recover_page_session(
            page=page, expected_state="home", mouse=mouse
        )
        rec_dict = recovery.model_dump() if hasattr(recovery, "model_dump") else {}
        if not getattr(recovery, "recovered", False):
            err = (
                getattr(recovery, "error", None)
                or f"Session recovery failed: {getattr(recovery, 'status', 'failed')}"
            )
            return (
                getattr(recovery, "page_state", "error"),
                "unrecoverable",
                rec_dict,
                err,
            )
        return "ok", "session_ready", rec_dict, None
    except Exception as rec_err:
        return (
            "error",
            "unrecoverable",
            {"recovered": False, "error": str(rec_err)},
            f"Session recovery encountered exception: {rec_err}",
        )


async def _check_session_and_page_state(
    *,
    user_id: str,
    page: Any,
    mouse: Any | None = None,
) -> tuple[str, str, dict[str, Any] | None, str | None]:
    """Check browser session existence, diagnose sentinel state, and auto-recover overlays."""
    if not _is_valid_page(page=page):
        return (
            "error",
            "unrecoverable",
            None,
            "No active browser page instance provided in state",
        )

    session_abort = _validate_user_session(user_id=user_id)
    if session_abort:
        return session_abort

    try:
        page_state = await detect_page_state(page)
    except Exception as e:
        logger.warning(f"Failed to detect page state: {e}")
        page_state = "error"

    if page_state in ("logged_out", "captcha"):
        return page_state, "unrecoverable", None, f"Unrecoverable state: {page_state}"

    has_overlay = False
    try:
        has_overlay = bool(await _detect_overlay(page=page))
    except Exception as overlay_err:
        logger.debug(f"Overlay check error: {overlay_err}")

    if page_state != "ok" or has_overlay:
        return await _perform_session_recovery(page=page, mouse=mouse)

    return "ok", "session_ready", None, None


async def init_and_recover_session_node(state: ScrapingGraphState) -> dict[str, Any]:
    """Verify stored session exists, detect page state, and auto-recover overlays."""
    raw_user_id = state.get("user_id")
    user_id = str(raw_user_id).strip() if raw_user_id else "default"
    page = state.get("page")
    mouse = state.get("mouse")

    try:
        (
            page_state,
            status,
            session_recovery,
            error,
        ) = await _check_session_and_page_state(
            user_id=user_id or "default", page=page, mouse=mouse
        )
        return {
            "page_state": page_state,
            "session_recovery": session_recovery,
            "status": status,
            "error": error,
        }

    except Exception as e:
        logger.error(f"Unexpected error in init_and_recover_session_node: {e}")
        return {
            "page_state": "error",
            "status": "unrecoverable",
            "error": str(e),
        }


async def scrape_explore_trends_node(state: ScrapingGraphState) -> dict[str, Any]:
    """Navigate to explore/trends and extract trending topic blocks."""
    page = state.get("page")
    if page is None:
        return {
            "scraped_topics": [],
            "status": "error",
            "error": "No page instance available for scraping",
        }

    try:
        try:
            nav_ok = await navigate_to_trends(page)
        except Exception as nav_err:
            logger.warning(f"navigate_to_trends raised exception: {nav_err}")
            nav_ok = False

        if not nav_ok:
            try:
                page_state = await detect_page_state(page)
            except Exception:
                page_state = "error"
            status = (
                "error"
                if page_state not in ("logged_out", "captcha")
                else "unrecoverable"
            )
            return {
                "scraped_topics": [],
                "page_state": page_state,
                "status": status,
                "error": f"Failed to navigate to trends: page state is {page_state}",
            }

        selectors = _load_selectors()
        raw_topics = await extract_trending_sidebar(page, selectors=selectors)

        formatted_topics = [
            fmt
            for t in (raw_topics or [])
            if (fmt := _format_single_topic(topic=t)) is not None
        ]

        return {
            "scraped_topics": formatted_topics,
            "status": "trends_extracted",
        }
    except Exception as e:
        logger.error(f"Error during scrape_explore_trends_node: {e}")
        return {
            "scraped_topics": [],
            "status": "error",
            "error": str(e),
        }


async def _navigate_topic_timeline(
    *, page: Any, topic_url: str, mouse: Any | None = None
) -> None:
    """Navigate to topic URL and perform stealth reading scroll."""
    try:
        await human_navigation(page=page, url=topic_url)
    except Exception:
        if hasattr(page, "goto"):
            await page.goto(topic_url, wait_until="domcontentloaded")

    await random_delay(min_sec=1.0, max_sec=2.0)
    if mouse and hasattr(mouse, "human_scroll"):
        try:
            await mouse.human_scroll(scrolls=2)
        except Exception as scroll_err:
            logger.debug(f"Scroll error: {scroll_err}")


async def _extract_topic_summary_and_tweets(
    *, page: Any, topic_url: str, selectors: dict[str, Any]
) -> tuple[str | None, list[dict[str, Any]]]:
    """Extract Grok summary and parse top timeline tweets."""
    summary = None
    try:
        summary = await extract_grok_summary(page)
    except Exception as sum_err:
        logger.debug(f"Grok summary extraction skipped: {sum_err}")

    raw_tweets = await extract_topic_tweets(
        page=page, topic_url=topic_url, selectors=selectors
    )
    tweets_data = [
        parsed
        for t in (raw_tweets or [])
        if (parsed := _parse_single_tweet(tweet=t)) is not None
    ]
    return summary, tweets_data


async def _extract_single_topic_flow(
    *,
    page: Any,
    topic_url: str,
    selectors: dict[str, Any],
    mouse: Any | None = None,
) -> tuple[str | None, list[dict[str, Any]]]:
    """Perform stealth navigation, summary extraction, tweet extraction, and return navigation."""
    await _navigate_topic_timeline(page=page, topic_url=topic_url, mouse=mouse)
    return await _extract_topic_summary_and_tweets(
        page=page, topic_url=topic_url, selectors=selectors
    )


async def extract_topic_timelines_node(state: ScrapingGraphState) -> dict[str, Any]:
    """For top N trending topics, navigate to timeline, extract tweets and Grok summary."""
    page = state.get("page")
    mouse = state.get("mouse")
    scraped_topics_raw = state.get("scraped_topics", [])
    scraped_topics = scraped_topics_raw if isinstance(scraped_topics_raw, list) else []
    max_topics = _parse_clamped_max_topics(val=state.get("max_topics"), default=3)

    topic_tweets_map: dict[str, list[dict[str, Any]]] = {}
    topic_summaries: dict[str, str] = {}
    failed_topics: list[dict[str, str]] = []

    if not scraped_topics or page is None:
        return {
            "topic_tweets_map": topic_tweets_map,
            "topic_summaries": topic_summaries,
            "failed_topics": failed_topics,
            "status": "tweets_extracted",
        }

    selectors = _load_selectors()
    candidates = list(scraped_topics)
    selected_topics = candidates[:max_topics]

    for idx, topic in enumerate(selected_topics):
        if idx > 0:
            await random_delay(min_sec=2.0, max_sec=4.0)
        topic_url = _get_topic_url(topic=topic)
        if not topic_url:
            continue
        try:
            summary, tweets = await _extract_single_topic_flow(
                page=page,
                topic_url=topic_url,
                selectors=selectors,
                mouse=mouse,
            )
            if summary:
                topic_summaries[topic_url] = str(summary)
            topic_tweets_map[topic_url] = tweets
        except Exception as e:
            logger.warning(f"Error extracting timeline for topic {topic_url}: {e}")
            failed_topics.append({"topic_url": topic_url, "reason": str(e)})

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
    if not scraped_topics:
        return {
            "persisted_topic_count": 0,
            "persisted_tweet_count": 0,
            "status": "persisted",
        }

    topic_tweets_map = (
        state.get("topic_tweets_map", {})
        if isinstance(state.get("topic_tweets_map"), dict)
        else {}
    )
    topic_summaries = (
        state.get("topic_summaries", {})
        if isinstance(state.get("topic_summaries"), dict)
        else {}
    )

    try:
        (
            persisted_topics,
            persisted_tweets,
            errors,
        ) = persist_scraped_batch_records(
            user_id_raw=state.get("user_id"),
            session_arg=state.get("session"),
            scraped_topics=scraped_topics,
            topic_tweets_map=topic_tweets_map,
            topic_summaries=topic_summaries,
        )

        if errors and persisted_topics == 0:
            return {
                "persisted_topic_count": 0,
                "persisted_tweet_count": 0,
                "status": "error",
                "error": "; ".join(errors),
            }

        return {
            "persisted_topic_count": persisted_topics,
            "persisted_tweet_count": persisted_tweets,
            "status": "persisted",
        }
    except Exception as e:
        logger.error(f"Error persisting scraped batch: {e}")
        return {
            "persisted_topic_count": 0,
            "persisted_tweet_count": 0,
            "status": "error",
            "error": str(e),
        }


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
