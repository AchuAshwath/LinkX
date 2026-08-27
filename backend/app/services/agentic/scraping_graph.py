"""LangGraph StateGraph for orchestrating end-to-end X.com trends scraping and persistence."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from sqlmodel import Session, select

from app import crud
from app.models import User
from app.services.agentic.schemas import ScrapedBatchReport
from app.services.agentic.session_recovery_graph import (
    _detect_overlay,
    recover_page_session,
)
from app.services.agentic.tools.common import get_active_page, resolve_session
from app.services.browser.diagnostics import detect_page_state, extract_grok_summary
from app.services.browser.manager import BrowserManager
from scripts.scrape_trending_topics import (
    extract_topic_tweets,
    extract_trending_sidebar,
    navigate_to_trends,
    parse_post_count,
)

logger = logging.getLogger(__name__)

SELECTORS_PATH = (
    Path(__file__).parent.parent / "browser" / "selectors" / "x_selectors.json"
)


class ScrapingGraphState(TypedDict, total=False):
    # Inputs
    user_id: str
    max_topics: int
    headless: bool
    session: Any
    # Browser & Recovery
    page: Any
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


def _load_selectors() -> dict[str, Any]:
    """Load selectors from JSON configuration with fallback defaults."""
    selectors: dict[str, Any] = {}
    if SELECTORS_PATH.exists():
        try:
            with open(SELECTORS_PATH, encoding="utf-8") as f:
                selectors = json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load x_selectors.json: {e}")
    if "selectors" not in selectors:
        selectors["selectors"] = {
            "sidebar_container": selectors.get("feed", {}).get(
                "news_trends",
                "[data-testid='sidebarColumn'], [data-testid='primaryColumn']",
            ),
            "sidebar_link": selectors.get("feed", {}).get(
                "news_trends", "[data-testid='trend'], a[href*='/search?q=']"
            ),
            "tweet_container": selectors.get("feed", {}).get(
                "timeline_post", "[data-testid='tweet']"
            ),
        }
    return selectors


def _parse_clamped_max_topics(val: Any, default: int = 3) -> int:
    """Safely parse and clamp max_topics to [1, 10]."""
    try:
        if val is None:
            return default
        parsed = int(val)
        return max(1, min(10, parsed))
    except (ValueError, TypeError):
        return default


def _safe_int(val: Any, default: int = 0) -> int:
    """Safely convert engagement metric or count to non-negative int."""
    if val is None:
        return default
    if isinstance(val, int):
        return max(0, val)
    if isinstance(val, float):
        return max(0, int(val))
    if isinstance(val, str):
        cleaned = val.strip().replace(",", "")
        try:
            return max(0, int(cleaned))
        except (ValueError, TypeError):
            parsed = parse_post_count(val)
            return max(0, parsed if parsed is not None else default)
    return default


def _resolve_user_id(*, user_id: Any, session: Session) -> uuid.UUID:
    """Resolve user ID string or UUID to a valid user UUID safely."""
    if isinstance(user_id, uuid.UUID):
        return user_id
    if user_id:
        try:
            return uuid.UUID(str(user_id).strip())
        except (ValueError, TypeError, AttributeError):
            pass
        try:
            user = session.exec(select(User).where(User.email == str(user_id))).first()
            if user:
                return user.id
        except Exception as e:
            logger.warning(f"Error querying user by email/id {user_id}: {e}")
    try:
        first_user = session.exec(select(User)).first()
        if first_user:
            return first_user.id
    except Exception as e:
        logger.warning(f"Error querying fallback user: {e}")
    return uuid.uuid4()


def _verify_session_exists(*, user_id: str) -> tuple[bool, str | None]:
    """Verify if user has stored session credentials."""
    try:
        manager = BrowserManager(user_id=user_id)
        if not manager.session_exists("x"):
            return False, "No stored X.com session found"
        return True, None
    except Exception as e:
        logger.warning(f"BrowserManager session check error: {e}")
        return False, f"Failed checking session: {e}"


async def _diagnose_and_recover_overlay(
    *, page: Any
) -> tuple[str, str, dict[str, Any] | None, str | None]:
    """Recover session when overlays or transient errors are diagnosed."""

    try:
        recovery = await recover_page_session(page=page, expected_state="home")
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
        logger.warning(f"Exception during session recovery: {rec_err}")
        return (
            "error",
            "unrecoverable",
            {"recovered": False, "error": str(rec_err)},
            f"Session recovery encountered exception: {rec_err}",
        )


async def _diagnose_page_health(page: Any) -> tuple[str, bool]:
    """Diagnose page state and check for overlays safely."""
    try:
        page_state = await detect_page_state(page)
    except Exception as e:
        logger.warning(f"Failed to detect page state: {e}")
        page_state = "error"

    has_overlay = False
    try:
        has_overlay = bool(await _detect_overlay(page=page))
    except Exception:
        pass

    return page_state, has_overlay


async def _check_session_and_page_state(
    *,
    user_id: str,
    page: Any,
) -> tuple[str, str, dict[str, Any] | None, str | None]:
    """Check browser session existence, diagnose sentinel state, and auto-recover overlays."""
    if page is None or (not hasattr(page, "goto") and not hasattr(page, "locator")):
        return (
            "error",
            "unrecoverable",
            None,
            "No active browser page instance provided in state",
        )

    has_session, session_err = _verify_session_exists(user_id=user_id)
    if not has_session:
        state = "logged_out" if "No stored" in (session_err or "") else "error"
        return state, "unrecoverable", None, session_err

    page_state, has_overlay = await _diagnose_page_health(page)
    if page_state in ("logged_out", "captcha"):
        return page_state, "unrecoverable", None, f"Unrecoverable state: {page_state}"

    if page_state != "ok" or has_overlay:
        return await _diagnose_and_recover_overlay(page=page)

    return "ok", "session_ready", None, None


async def init_and_recover_session_node(state: ScrapingGraphState) -> dict[str, Any]:
    """Verify stored session exists, detect page state, and auto-recover overlays."""
    raw_user_id = state.get("user_id")
    user_id = str(raw_user_id).strip() if raw_user_id else "default"
    page = state.get("page")

    try:
        (
            page_state,
            status,
            session_recovery,
            error,
        ) = await _check_session_and_page_state(user_id=user_id or "default", page=page)
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


def _format_single_topic(t: Any) -> dict[str, Any] | None:
    """Format and sanitize a single raw topic dictionary or model."""
    if not t:
        return None
    if isinstance(t, dict):
        raw_title = t.get("topic_title") or t.get("title")
        raw_url = t.get("topic_url") or t.get("url")
        category = t.get("category")
        post_count = t.get("post_count")
        summary = t.get("summary")
    else:
        raw_title = getattr(t, "topic_title", None) or getattr(t, "title", None)
        raw_url = getattr(t, "topic_url", None) or getattr(t, "url", None)
        category = getattr(t, "category", None)
        post_count = getattr(t, "post_count", None)
        summary = getattr(t, "summary", None)

    title = str(raw_title).strip() if raw_title is not None else ""
    url = str(raw_url).strip() if raw_url is not None else ""
    return {
        "topic_title": title,
        "title": title,
        "topic_url": url,
        "url": url,
        "category": str(category) if category is not None else None,
        "post_count": post_count,
        "summary": str(summary) if summary is not None else None,
    }


async def _try_navigate_to_trends(page: Any) -> tuple[bool, str]:
    """Attempt navigation to trends and return page state on failure."""
    try:
        nav_ok = await navigate_to_trends(page)
    except Exception as nav_err:
        logger.warning(f"navigate_to_trends raised exception: {nav_err}")
        nav_ok = False

    if nav_ok:
        return True, "ok"

    try:
        page_state = await detect_page_state(page)
    except Exception:
        page_state = "error"
    return False, page_state


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
        nav_ok, page_state = await _try_navigate_to_trends(page)
        if not nav_ok:
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
            if (fmt := _format_single_topic(t)) is not None
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


def _parse_single_tweet(t: Any) -> dict[str, Any] | None:
    """Parse and sanitize a raw tweet model or dictionary."""
    if not t:
        return None
    if isinstance(t, dict):
        raw_author = t.get("author_handle") or t.get("author")
        raw_text = t.get("text")
        replies = t.get("replies")
        retweets = t.get("retweets")
        likes = t.get("likes")
        views = t.get("views")
    else:
        raw_author = getattr(t, "author_handle", None) or getattr(t, "author", None)
        raw_text = getattr(t, "text", "")
        replies = getattr(t, "replies", None)
        retweets = getattr(t, "retweets", None)
        likes = getattr(t, "likes", None)
        views = getattr(t, "views", None)

    author_handle = str(raw_author).strip() if raw_author else "unknown"
    if not author_handle:
        author_handle = "unknown"
    text_val = str(raw_text) if raw_text is not None else ""

    return {
        "author_handle": author_handle[:255],
        "text": text_val,
        "replies": _safe_int(replies),
        "retweets": _safe_int(retweets),
        "likes": _safe_int(likes),
        "views": _safe_int(views),
    }


async def _extract_single_topic_timeline(
    *,
    page: Any,
    topic_url: str,
    selectors: dict[str, Any],
) -> tuple[str | None, list[dict[str, Any]]]:
    """Navigate to topic URL and extract Grok summary + top tweets."""
    try:
        page_url = getattr(page, "url", None)
    except Exception:
        page_url = None

    if page_url != topic_url and hasattr(page, "goto") and callable(page.goto):
        await page.goto(topic_url, wait_until="domcontentloaded")

    summary = None
    try:
        summary = await extract_grok_summary(page)
    except Exception as sum_err:
        logger.debug(
            f"Grok summary extraction skipped/failed for {topic_url}: {sum_err}"
        )

    raw_tweets = await extract_topic_tweets(
        page=page, topic_url=topic_url, selectors=selectors
    )

    tweets_data = [
        parsed
        for t in (raw_tweets or [])
        if (parsed := _parse_single_tweet(t)) is not None
    ]
    return summary, tweets_data


async def extract_topic_timelines_node(state: ScrapingGraphState) -> dict[str, Any]:
    """Extract Grok summary and top tweets for each topic with partial batch resilience."""
    page = state.get("page")
    scraped_topics_raw = state.get("scraped_topics", [])
    scraped_topics = scraped_topics_raw if isinstance(scraped_topics_raw, list) else []
    max_topics = _parse_clamped_max_topics(state.get("max_topics"), default=3)

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
    topics_to_process = scraped_topics[:max_topics]

    for topic in topics_to_process:
        if not topic:
            continue
        raw_url = (
            topic.get("topic_url") or topic.get("url")
            if isinstance(topic, dict)
            else getattr(topic, "topic_url", None)
        )
        topic_url = str(raw_url).strip() if raw_url is not None else ""
        if not topic_url or not topic_url.startswith(("http://", "https://")):
            continue

        try:
            summary, tweets = await _extract_single_topic_timeline(
                page=page, topic_url=topic_url, selectors=selectors
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


def _persist_single_topic_record(
    *,
    session: Session,
    resolved_user_id: uuid.UUID,
    topic: dict[str, Any],
    tweets_map: dict[str, list[dict[str, Any]]],
    summaries: dict[str, str],
    now: datetime,
) -> tuple[int, int]:
    """Persist a single topic and its associated tweets to the database."""
    url = str(topic.get("topic_url") or topic.get("url", "")).strip()
    if not url:
        return 0, 0

    title = str(topic.get("topic_title") or topic.get("title", "")).strip()
    category = topic.get("category")
    post_count_val = topic.get("post_count")
    if isinstance(post_count_val, str):
        post_count_val = parse_post_count(post_count_val)
    elif isinstance(post_count_val, (int, float)):
        post_count_val = int(post_count_val)
    else:
        post_count_val = None

    summary_val = summaries.get(url) or topic.get("summary")
    summary_str = str(summary_val) if summary_val is not None else None

    topic_data = {
        "user_id": resolved_user_id,
        "topic_url": url[:512],
        "topic_title": title[:500],
        "category": str(category)[:100] if category is not None else None,
        "post_count": post_count_val,
        "summary": summary_str,
        "last_seen_at": now,
        "scraped_at": now,
    }

    topic_record = crud.upsert_trending_topic(session=session, topic_data=topic_data)
    tweets = tweets_map.get(url, [])
    persisted_tweets = 0
    if tweets and isinstance(tweets, list):
        crud.replace_trending_tweets(
            session=session, topic_id=topic_record.id, tweets_data=tweets
        )
        persisted_tweets = len(tweets)
    return 1, persisted_tweets


async def persist_scraped_batch_node(state: ScrapingGraphState) -> dict[str, Any]:
    """Persist scraped topics and tweets into PostgreSQL via CRUD upsert."""
    scraped_topics_raw = state.get("scraped_topics", [])
    scraped_topics = scraped_topics_raw if isinstance(scraped_topics_raw, list) else []
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
    user_id_raw = state.get("user_id")

    if not scraped_topics:
        return {
            "persisted_topic_count": 0,
            "persisted_tweet_count": 0,
            "status": "persisted",
        }

    persisted_topics = 0
    persisted_tweets = 0

    try:
        with resolve_session(session=state.get("session")) as session:
            resolved_user_id = _resolve_user_id(user_id=user_id_raw, session=session)
            now = datetime.now(timezone.utc)
            errors: list[str] = []

            for topic in scraped_topics:
                if not topic:
                    continue
                try:
                    t_count, tw_count = _persist_single_topic_record(
                        session=session,
                        resolved_user_id=resolved_user_id,
                        topic=topic if isinstance(topic, dict) else {},
                        tweets_map=topic_tweets_map,
                        summaries=topic_summaries,
                        now=now,
                    )
                    persisted_topics += t_count
                    persisted_tweets += tw_count
                except Exception as topic_err:
                    logger.warning(f"Error persisting topic: {topic_err}")
                    errors.append(str(topic_err))
                    try:
                        session.rollback()
                    except Exception:
                        pass

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
            "persisted_topic_count": persisted_topics,
            "persisted_tweet_count": persisted_tweets,
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
    workflow.add_edge("scrape_explore_trends", "extract_topic_timelines")
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


def _format_scraped_batch_report(*, final_state: dict[str, Any]) -> ScrapedBatchReport:
    """Format and validate final ScrapedBatchReport from completed graph state."""
    return ScrapedBatchReport(
        scraped_topics=final_state.get("scraped_topics", []),
        topic_tweets_map=final_state.get("topic_tweets_map", {}),
        topic_summaries=final_state.get("topic_summaries", {}),
        failed_topics=final_state.get("failed_topics", []),
        persisted_topic_count=int(final_state.get("persisted_topic_count", 0)),
        persisted_tweet_count=int(final_state.get("persisted_tweet_count", 0)),
        page_state=final_state.get("page_state", "ok"),
        session_recovery=final_state.get("session_recovery"),
        status=final_state.get("status", "persisted"),
        error=final_state.get("error"),
    )


async def scrape_trends_with_graph(
    *,
    user_id: str,
    max_topics: int = 3,
    headless: bool = True,
    thread_id: str | None = None,
    session: Any = None,
    config: dict[str, Any] | None = None,
) -> ScrapedBatchReport:
    """Run the ScrapingGraph to harvest, extract, and persist trending topics from X."""
    clamped_max_topics = _parse_clamped_max_topics(max_topics, default=3)
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
            initial_state: ScrapingGraphState = {
                "user_id": sanitized_user_id,
                "max_topics": clamped_max_topics,
                "headless": headless,
                "session": session,
                "page": page,
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

            final_state = await _scraping_graph.ainvoke(
                initial_state, config=run_config if run_config else None
            )
            return _format_scraped_batch_report(final_state=final_state)
    except Exception as e:
        logger.error(f"Error during scrape_trends_with_graph execution: {e}")
        return _make_abort_scraped_batch_report(page_state="error", error=str(e))
