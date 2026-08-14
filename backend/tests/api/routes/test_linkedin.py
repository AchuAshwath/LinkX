import logging
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.api.routes.test_posts import _create_user_with_auth


def test_linkedin_disconnect_ok_when_redis_delete_fails(
    client: TestClient,
    db: Session,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Disconnect remains best-effort: DB row removed even if Redis delete fails; failure is logged."""
    user, headers = _create_user_with_auth(client=client, db=db)

    class _FailingRedis:
        def delete(self, *_args: object, **_kwargs: object) -> None:
            msg = "redis unavailable"
            raise ConnectionError(msg)

    with patch(
        "app.api.routes.linkedin.get_redis",
        return_value=_FailingRedis(),
    ):
        with caplog.at_level(logging.WARNING, logger="app.api.routes.linkedin"):
            response = client.delete(
                f"{settings.API_V1_STR}/linkedin/disconnect",
                headers=headers,
            )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert any(
        "Redis delete failed" in r.message and "best-effort" in r.message
        for r in caplog.records
    )
