from typing import Any

from fastapi import APIRouter

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import TrendingTopicsPublic

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
