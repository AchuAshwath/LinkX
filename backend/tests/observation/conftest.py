import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.routes import ai_browser_chat, ai_threads
from app.core.config import settings
from app.core.db import engine
from app.main import app
from app.models import ChatThread, User
from tests.utils.utils import get_superuser_token_headers


@pytest.fixture
def api_client() -> Generator[TestClient, None, None]:
    with TestClient(app) as client:
        yield client


@pytest.fixture
def auth_headers(api_client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(api_client)


@pytest.fixture(autouse=True)
def preflight_model_input(monkeypatch: pytest.MonkeyPatch) -> None:
    def preflight(*, request: Any) -> None:
        assert request.context is not None
        return None

    monkeypatch.setattr(ai_browser_chat.browser_model, "preflight", preflight)


@pytest.fixture(autouse=True)
def fake_browser_title_model(monkeypatch: pytest.MonkeyPatch) -> None:
    async def no_title(**_: Any) -> None:
        return None

    monkeypatch.setattr(ai_threads, "generate_ai_thread_title", no_title)


@pytest.fixture
def committed_thread() -> Generator[uuid.UUID, None, None]:
    with Session(engine) as session:
        owner = session.exec(
            select(User).where(User.email == settings.FIRST_SUPERUSER)
        ).first()
        assert owner is not None
        thread = ChatThread(owner_id=owner.id, title="New conversation")
        session.add(thread)
        session.commit()
        session.refresh(thread)
        thread_id = thread.id
    try:
        yield thread_id
    finally:
        with Session(engine) as session:
            thread = session.get(ChatThread, thread_id)
            if thread is not None:
                session.delete(thread)
                session.commit()
