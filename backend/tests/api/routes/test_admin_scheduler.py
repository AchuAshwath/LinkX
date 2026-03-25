from fastapi.testclient import TestClient

from app.core.config import settings


def test_scheduler_status_requires_superuser(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    url = f"{settings.API_V1_STR}/admin/scheduler/status"

    r_forbidden = client.get(url, headers=normal_user_token_headers)
    assert r_forbidden.status_code == 403

    r_ok = client.get(url, headers=superuser_token_headers)
    assert r_ok.status_code == 200
    data = r_ok.json()

    assert "now" in data
    assert "total_posts" in data
    assert "by_status" in data
    assert "due_scheduled" in data
    assert "due_retries" in data
    assert "recent_failures" in data
