from datetime import datetime, timezone
from unittest.mock import patch

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
