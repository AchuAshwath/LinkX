"""Autonomous Trend-to-Draft Composite Pipeline orchestrating ScrapingGraph and CurationGraph."""

from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, START, StateGraph

from app.services.agentic.curation_graph import curate_and_draft_post
from app.services.agentic.schemas import (
    CuratedDraftReport,
    TrendToDraftReport,
    TrendToDraftState,
)
from app.services.agentic.scraping_graph import scrape_trends_with_graph

logger = logging.getLogger(__name__)

__all__ = [
    "TrendToDraftState",
    "build_trend_to_draft_pipeline",
    "generate_curated_drafts_node",
    "harvest_trends_node",
    "route_after_harvest",
    "run_trend_to_draft_pipeline",
]


def _evaluate_harvest_outcome(
    *, scrape_report: Any
) -> tuple[list[dict[str, Any]], str, str | None]:
    """Extract scraped topics, status, and failure reason from ScrapingGraph report."""
    topics = scrape_report.scraped_topics or []
    if scrape_report.status in ("unrecoverable", "error"):
        error_message = scrape_report.error or "Scraping failed"
        return topics, "error", error_message
    status = "empty_trends" if not topics else "scraped"
    return topics, status, None


async def harvest_trends_node(state: TrendToDraftState) -> dict[str, Any]:
    """Execute ScrapingGraph to harvest live explore trends and topic tweets."""
    user_id = state.get("user_id", "")
    max_topics = max(1, min(state.get("max_topics", 3), 10))
    headless = state.get("headless", True)
    session = state.get("session")

    try:
        scrape_report = await scrape_trends_with_graph(
            user_id=user_id,
            max_topics=max_topics,
            headless=headless,
            session=session,
        )
        topics, status, error_message = _evaluate_harvest_outcome(
            scrape_report=scrape_report
        )
        return {
            "scraped_topics": topics,
            "status": status,
            "error": error_message,
        }
    except Exception as exc:
        logger.exception(f"Harvest trends node failed: {exc}")
        return {"scraped_topics": [], "status": "error", "error": str(exc)}


def route_after_harvest(state: TrendToDraftState) -> str:
    """Determine whether to proceed with curation or terminate on empty/error."""
    if state.get("error"):
        return END
    if not state.get("scraped_topics"):
        return END
    return "generate_curated_drafts"


async def _curate_single_topic(
    *,
    state: TrendToDraftState,
    topic_item: dict[str, Any],
) -> CuratedDraftReport | None:
    """Curate and refine a single social draft for a given topic."""
    if not isinstance(topic_item, dict):
        return None
    raw_title = topic_item.get("title")
    title = str(raw_title).strip() if raw_title else "Trending Topic"
    raw_id = topic_item.get("id")
    topic_id = str(raw_id).strip() if raw_id is not None else None
    try:
        return await curate_and_draft_post(
            user_id=state.get("user_id", ""),
            topic_title=title,
            topic_id=topic_id,
            platform=state.get("platform", "both"),
            target_tone=state.get("target_tone"),
            session=state.get("session"),
        )
    except Exception as exc:
        logger.warning(f"Draft curation failed for topic '{title}': {exc}")
        return None


def _compute_curation_status(*, had_error: bool, drafts_count: int) -> str:
    """Determine curation status based on partial or complete failure."""
    if not had_error:
        return "completed"
    return "partial_failure" if drafts_count > 0 else "error"


async def generate_curated_drafts_node(
    state: TrendToDraftState,
) -> dict[str, Any]:
    """Iterate through harvested trends and synthesize polished post drafts via CurationGraph."""
    topics = state.get("scraped_topics", [])

    curated_drafts: list[dict[str, Any]] = []
    persisted_ids: list[str] = []
    had_error = False

    for topic_item in topics:
        curate_report = await _curate_single_topic(
            state=state,
            topic_item=topic_item,
        )
        if curate_report is None:
            had_error = True
            continue
        curated_drafts.append(curate_report.model_dump())
        if curate_report.persisted_post_id:
            persisted_ids.append(curate_report.persisted_post_id)

    status = _compute_curation_status(
        had_error=had_error, drafts_count=len(curated_drafts)
    )
    return {
        "curated_drafts": curated_drafts,
        "persisted_post_ids": persisted_ids,
        "status": status,
    }


def build_trend_to_draft_pipeline() -> Any:
    """Construct and compile the AutonomousTrendToDraft composite pipeline StateGraph."""
    workflow = StateGraph(TrendToDraftState)
    workflow.add_node("harvest_trends", harvest_trends_node)
    workflow.add_node("generate_curated_drafts", generate_curated_drafts_node)

    workflow.add_edge(START, "harvest_trends")
    workflow.add_conditional_edges(
        "harvest_trends",
        route_after_harvest,
        {
            END: END,
            "generate_curated_drafts": "generate_curated_drafts",
        },
    )
    workflow.add_edge("generate_curated_drafts", END)
    return workflow.compile()


_trend_to_draft_pipeline = build_trend_to_draft_pipeline()


async def run_trend_to_draft_pipeline(
    *,
    user_id: str,
    max_topics: int = 3,
    platform: str = "both",
    **kwargs: Any,
) -> TrendToDraftReport:
    """Execute the AutonomousTrendToDraft pipeline from live explore scraping to draft persistence."""
    user_id_clean = str(user_id or "").strip()
    if not user_id_clean:
        return TrendToDraftReport(
            scraped_topics=[],
            curated_drafts=[],
            persisted_post_ids=[],
            platform=platform,
            status="error",
            error="Missing required user_id",
        )

    target_tone: str | None = kwargs.get("target_tone")
    headless: bool = kwargs.get("headless", True)
    session: Any = kwargs.get("session")
    config: dict[str, Any] | None = kwargs.get("config")

    initial_state: TrendToDraftState = {
        "user_id": user_id_clean,
        "max_topics": max(1, min(max_topics, 10)),
        "platform": platform.lower().strip(),
        "target_tone": target_tone,
        "headless": headless,
        "session": session,
        "scraped_topics": [],
        "curated_drafts": [],
        "persisted_post_ids": [],
        "status": "initializing",
        "error": None,
    }

    try:
        final_state = await _trend_to_draft_pipeline.ainvoke(
            initial_state, config=dict(config or {})
        )
        topics = final_state.get("scraped_topics", [])
        drafts = [
            CuratedDraftReport.model_validate(d)
            for d in final_state.get("curated_drafts", [])
        ]
        status = final_state.get("status", "completed" if drafts else "empty_trends")
        if final_state.get("error"):
            status = "error"

        return TrendToDraftReport(
            scraped_topics=topics,
            curated_drafts=drafts,
            persisted_post_ids=final_state.get("persisted_post_ids", []),
            platform=platform,
            status=status,
            error=final_state.get("error"),
        )
    except Exception as exc:
        logger.exception(f"TrendToDraft pipeline execution failed: {exc}")
        return TrendToDraftReport(
            scraped_topics=[],
            curated_drafts=[],
            persisted_post_ids=[],
            platform=platform,
            status="error",
            error=str(exc),
        )
