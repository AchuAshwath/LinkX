import os
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, status

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import PostPublic, TrendingTopicsPublic
from app.services.browser.manager import BrowserManager

router = APIRouter(prefix="/trending", tags=["trending"])


@router.get("/", response_model=TrendingTopicsPublic)
def get_trending(
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    """
    Get the latest scraped trending topics for the current user.
    """
    topics = crud.get_latest_trending_topics(session=session, user_id=current_user.id)
    return TrendingTopicsPublic(data=topics, count=len(topics))


@router.post("/extract", response_model=TrendingTopicsPublic)
async def extract_trending_topics(
    session: SessionDep,
    current_user: CurrentUser,
    max_topics: int = 3,
) -> Any:
    """
    Trigger live extraction/scraping of trending topics from X.com for the current user.
    """
    manager = BrowserManager(user_id=str(current_user.id))
    if not manager.session_exists("x"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X.com session not connected. Please connect your X account in Social Accounts before extracting trends.",
        )

    from app.services.agentic.scraping_graph import scrape_trends_with_graph

    headless = os.environ.get("PLAYWRIGHT_HEADLESS", "1") == "1"
    report = await scrape_trends_with_graph(
        user_id=str(current_user.id),
        max_topics=max_topics,
        headless=headless,
        session=session,
    )

    if (
        report.status in ["unrecoverable", "error"]
        and report.persisted_topic_count == 0
    ):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to extract trends from X ({report.status}): {report.error or 'Unknown error'}",
        )

    topics = crud.get_latest_trending_topics(session=session, user_id=current_user.id)
    return TrendingTopicsPublic(data=topics, count=len(topics))


@router.post("/{topic_id}/draft", response_model=PostPublic)
async def draft_from_trending_topic(
    *,
    topic_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
    platform: str = "both",
) -> Any:
    """Curate and refine a social post draft from a database trending topic using CurationGraph."""
    from app.api.routes.posts import serialize_post_with_author
    from app.models import Post, TrendingTopic
    from app.services.agentic.curation_graph import curate_and_draft_post

    topic = session.get(TrendingTopic, topic_id)
    if not topic or topic.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trending topic not found",
        )

    report = await curate_and_draft_post(
        user_id=str(current_user.id),
        topic_title=topic.topic_title,
        topic_id=str(topic.id),
        platform=platform,
        session=session,
    )

    if not report.persisted_post_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate draft: {report.error or 'Unknown error'}",
        )

    post = session.get(Post, uuid.UUID(report.persisted_post_id))
    if not post:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Draft post created but could not be loaded",
        )

    return serialize_post_with_author(session=session, post=post)
