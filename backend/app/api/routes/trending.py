import os
from typing import Any

from fastapi import APIRouter, HTTPException, status

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import TrendingTopicsPublic
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

    from scripts.scrape_trending_topics import scrape_trending_topics

    headless = os.environ.get("PLAYWRIGHT_HEADLESS", "1") == "1"
    result = await scrape_trending_topics(
        user_id=str(current_user.id),
        max_topics=max_topics,
        headless=headless,
    )

    if result.status in ["auth_failed", "captcha", "rate_limited", "error"]:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to extract trends from X ({result.status}): {'; '.join(result.errors) if result.errors else 'Unknown error'}",
        )

    topics = crud.get_latest_trending_topics(session=session, user_id=current_user.id)
    return TrendingTopicsPublic(data=topics, count=len(topics))
