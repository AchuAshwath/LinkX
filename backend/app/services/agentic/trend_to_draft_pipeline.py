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


async def harvest_trends_node(state: TrendToDraftState) -> dict[str, Any]:
    """Execute ScrapingGraph to harvest live explore trends and topic tweets."""
    user_id = state.get("user_id", "")
    max_topics = max(1, min(state.get("max_topics", 3), 10))
    headless = state.get("headless", True)
    session = state.get("session")

    try:
        scrape_rep = await scrape_trends_with_graph(
            user_id=user_id,
            max_topics=max_topics,
            headless=headless,
            session=session,
        )
        topics = scrape_rep.scraped_topics or []
        err = scrape_rep.error if scrape_rep.status == "unrecoverable" else None
        status = "error" if err else ("empty_trends" if not topics else "scraped")
        return {"scraped_topics": topics, "status": status, "error": err}
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


async def generate_curated_drafts_node(
    state: TrendToDraftState,
) -> dict[str, Any]:
    """Iterate through harvested trends and synthesize polished post drafts via CurationGraph."""
    user_id = state.get("user_id", "")
    platform = state.get("platform", "both")
    target_tone = state.get("target_tone")
    session = state.get("session")
    topics = state.get("scraped_topics", [])

    curated_drafts: list[dict[str, Any]] = []
    persisted_ids: list[str] = []
    had_error = False

    for top in topics:
        title = top.get("title", "")
        top_id = top.get("id")
        try:
            cur_rep = await curate_and_draft_post(
                user_id=user_id,
                topic_title=title,
                topic_id=top_id,
                platform=platform,
                target_tone=target_tone,
                session=session,
            )
            curated_drafts.append(cur_rep.model_dump())
            if cur_rep.persisted_post_id:
                persisted_ids.append(cur_rep.persisted_post_id)
        except Exception as exc:
            logger.warning(f"Draft curation failed for topic '{title}': {exc}")
            had_error = True

    status = (
        "completed"
        if not had_error
        else ("partial_failure" if curated_drafts else "error")
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
    target_tone: str | None = kwargs.get("target_tone")
    headless: bool = kwargs.get("headless", True)
    session: Any = kwargs.get("session")
    config: dict[str, Any] | None = kwargs.get("config")

    initial_state: TrendToDraftState = {
        "user_id": user_id.strip(),
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
