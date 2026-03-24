from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine, init_db
from app.main import app
from app.models import User
from tests.utils.user import authentication_token_from_email
from tests.utils.utils import get_superuser_token_headers

# Keep in sync with docs/TODO.md (seeded dev accounts).
_SEEDED_TODO_EMAILS: tuple[str, ...] = (
    "olivia.martinez.4192@example.com",
    "ethan.chen.4193@example.com",
    "ava.johnson.4194@example.com",
    "noah.patel.4195@example.com",
    "mia.williams.4196@example.com",
    "liam.garcia.4197@example.com",
    "sophia.brown.4198@example.com",
    "lucas.nguyen.4199@example.com",
    "isabella.davis.4200@example.com",
    "james.wilson.4201@example.com",
)


def _allowed_emails() -> set[str]:
    return {
        settings.FIRST_SUPERUSER.lower(),
        *[e.lower() for e in _SEEDED_TODO_EMAILS],
    }


def _cleanup_ephemeral_test_users() -> None:
    """Remove users not in the first superuser + TODO allowlist (test noise)."""
    allow = _allowed_emails()
    with Session(engine) as session:
        for user in session.exec(select(User)).all():
            if user.email.lower() not in allow:
                session.delete(user)
        session.commit()


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    if getattr(session.config.option, "collectonly", False):
        return
    _cleanup_ephemeral_test_users()


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        init_db(session)
        yield session


@pytest.fixture(scope="module")
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture(scope="module")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db
    )
