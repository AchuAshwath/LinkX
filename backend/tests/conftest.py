import os
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.deps import get_db
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


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:  # noqa: ARG001
    if getattr(session.config.option, "collectonly", False):
        return
    # Destructive: deletes every user not in the superuser + seeded TODO allowlist.
    # Only run when explicitly opted in so pytest cannot wipe a misconfigured non-test DB.
    if os.environ.get("LINKX_PYTEST_CLEANUP_EPHEMERAL_USERS") != "1":
        return
    _cleanup_ephemeral_test_users()


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(scope="session", autouse=True)
def _init_db_session() -> None:
    """One-time committed seed (superuser, default team/persona) for all tests."""
    with Session(engine) as session:
        init_db(session)


@pytest.fixture(scope="function")
def db() -> Generator[Session, None, None]:
    """
    Per-test DB session: outer connection transaction is rolled back after each test
    so API commits do not leak across tests (savepoints via join_transaction_mode).

    Note: this assumes tests use the synchronous TestClient (one request at a time).
    If you add async/concurrent tests, you may need a different session strategy.
    """
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture(scope="function")
def client(db: Session) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(scope="function")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture(scope="function")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db
    )
