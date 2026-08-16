from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.api.routes.test_posts import _create_user_with_auth


def test_x_status_endpoint(
    client: TestClient,
    db: Session,
) -> None:
    _user, headers = _create_user_with_auth(client=client, db=db)

    with (
        patch(
            "app.services.browser.manager.BrowserManager.session_exists",
            return_value=True,
        ),
        patch(
            "app.services.browser.manager.BrowserManager.read_session_metadata",
            return_value={
                "is_premium": True,
                "max_character_limit": 25000,
                "username": "verified_user",
                "display_name": "Verified User",
            },
        ),
    ):
        response = client.get(
            f"{settings.API_V1_STR}/auth/x/status",
            headers=headers,
        )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "connected"
    assert data["cookie_files_found"] is True
    assert data["is_premium"] is True
    assert data["max_character_limit"] == 25000
    assert data["username"] == "verified_user"
    assert "session_dir" in data


def test_linkedin_status_endpoint(
    client: TestClient,
    db: Session,
) -> None:
    _user, headers = _create_user_with_auth(client=client, db=db)

    response = client.get(
        f"{settings.API_V1_STR}/linkedin/status",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert "connected" in data
    assert data["connected"] is False
