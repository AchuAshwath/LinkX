from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import TrendingTopic
from tests.api.routes.test_posts import _create_user_with_auth


def test_get_trending_topics_empty(
    client: TestClient,
    db: Session,
) -> None:
    _user, headers = _create_user_with_auth(client=client, db=db)

    response = client.get(
        f"{settings.API_V1_STR}/trending/",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 0
    assert data["data"] == []


def test_get_trending_topics_populated(
    client: TestClient,
    db: Session,
) -> None:
    user, headers = _create_user_with_auth(client=client, db=db)

    now = datetime.now(timezone.utc)
    topic = TrendingTopic(
        user_id=user.id,
        topic_url="https://x.com/i/trending/123",
        topic_title="Valorant Champions Tour",
        category="Sports",
        post_count=15000,
        scraped_at=now,
    )
    db.add(topic)
    db.commit()

    response = client.get(
        f"{settings.API_V1_STR}/trending/",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1
    assert data["data"][0]["topic_title"] == "Valorant Champions Tour"
    assert data["data"][0]["category"] == "Sports"
    assert data["data"][0]["post_count"] == 15000


def test_extract_trending_requires_x_connection(
    client: TestClient,
    db: Session,
) -> None:
    _user, headers = _create_user_with_auth(client=client, db=db)

    with patch(
        "app.services.browser.manager.BrowserManager.session_exists", return_value=False
    ):
        response = client.post(
            f"{settings.API_V1_STR}/trending/extract",
            headers=headers,
        )
    assert response.status_code == 400
    assert "not connected" in response.json()["detail"].lower()


@pytest.mark.parametrize(
    "scenario",
    [
        ("persisted", None, 200),
        ("unrecoverable", "CAPTCHA challenge encountered", 500),
    ],
)
def test_extract_trending_topics_scenarios(
    client: TestClient,
    db: Session,
    scenario: tuple[str, str | None, int],
) -> None:
    report_status, error_msg, expected_status = scenario
    _user, headers = _create_user_with_auth(client=client, db=db)
    from app.services.agentic.schemas import ScrapedBatchReport

    mock_report = ScrapedBatchReport(
        scraped_topics=[
            {"topic_title": "AI Breakthroughs", "topic_url": "https://x.com/123"}
        ]
        if report_status == "persisted"
        else [],
        persisted_topic_count=1 if report_status == "persisted" else 0,
        status=report_status,
        error=error_msg,
    )

    with (
        patch(
            "app.services.browser.manager.BrowserManager.session_exists",
            return_value=True,
        ),
        patch(
            "app.services.agentic.scraping_graph.scrape_trends_with_graph",
            return_value=mock_report,
        ),
    ):
        response = client.post(
            f"{settings.API_V1_STR}/trending/extract",
            headers=headers,
        )

    assert response.status_code == expected_status
    if error_msg:
        assert error_msg in response.json()["detail"]


def test_draft_from_trending_topic_success(
    client: TestClient,
    db: Session,
) -> None:
    user, headers = _create_user_with_auth(client=client, db=db)

    now = datetime.now(timezone.utc)
    topic = TrendingTopic(
        user_id=user.id,
        topic_url="https://x.com/i/trending/ai_trends",
        topic_title="AI Agent Breakthroughs",
        category="Tech",
        post_count=50000,
        scraped_at=now,
    )
    db.add(topic)
    db.commit()

    from app.models import Post
    from app.services.agentic.schemas import CuratedDraftReport

    created_post = Post(
        owner_id=user.id,
        content="AI Agent Breakthroughs are transforming developer productivity.",
        platform="both",
        status="draft",
    )
    db.add(created_post)
    db.commit()

    mock_report = CuratedDraftReport(
        draft_content=created_post.content,
        refined_content=created_post.content,
        is_compliant=True,
        topic_title=topic.topic_title,
        persisted_post_id=str(created_post.id),
        status="persisted",
    )

    with patch(
        "app.services.agentic.curation_graph.curate_and_draft_post",
        return_value=mock_report,
    ):
        response = client.post(
            f"{settings.API_V1_STR}/trending/{topic.id}/draft",
            headers=headers,
        )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(created_post.id)
    assert data["content"] == created_post.content
    assert data["status"] == "draft"


def test_draft_from_trending_topic_not_found(
    client: TestClient,
    db: Session,
) -> None:
    _user, headers = _create_user_with_auth(client=client, db=db)
    import uuid

    fake_id = uuid.uuid4()
    response = client.post(
        f"{settings.API_V1_STR}/trending/{fake_id}/draft",
        headers=headers,
    )
    assert response.status_code == 404
