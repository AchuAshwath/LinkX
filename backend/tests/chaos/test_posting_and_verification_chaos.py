"""Chaos, adversarial resilience, and concurrency tests for PostingGraph and VerificationGraph."""

from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.models import Post
from app.services.agentic.posting_graph import publish_post_with_graph
from app.services.agentic.schemas import (
    AccountStatusReport,
    PostingGraphReport,
    VerificationGraphReport,
)
from app.services.agentic.verification_graph import verify_posts_with_graph


@pytest.mark.anyio
@pytest.mark.parametrize(
    "adversarial_content",
    [
        "A" * 50000,
        "Payload with null byte \x00 in middle",
        "'; DROP TABLE post; --",
        "<script>alert('xss')</script>",
        "🚀" * 500,
        "",
    ],
)
async def test_chaos_adversarial_payload_fuzzing(
    adversarial_content: str,
) -> None:
    """Chaos 1: Fuzzing with huge strings, SQLi, XSS, and null bytes never crashes graph."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    fake_post = Post(
        id=uuid.UUID(post_id),
        owner_id=uuid.UUID(user_id),
        content=adversarial_content or "fallback",
        platform="x",
        status="draft",
    )

    with (
        patch("app.crud.get_post", return_value=fake_post),
        patch(
            "app.services.agentic.posting_graph.get_social_account_status",
            return_value=AccountStatusReport(
                user_id=user_id, x_connected=True, linkedin_connected=False
            ),
        ),
        patch(
            "app.services.agentic.posting_graph.dispatch_x_post",
            new_callable=AsyncMock,
            return_value=(True, "1829384729384", None),
        ),
        patch(
            "app.services.agentic.posting_graph.verify_posts_with_graph",
            new_callable=AsyncMock,
            return_value=VerificationGraphReport(
                verified_post_ids=[post_id], status="completed"
            ),
        ),
        patch("app.services.agentic.posting_graph._mark_as_published"),
    ):
        report = await publish_post_with_graph(
            user_id=user_id,
            post_id=post_id,
            platform="x",
        )
        assert isinstance(report, PostingGraphReport)
        assert report.status in ("published", "error")


@pytest.mark.anyio
async def test_chaos_network_timeout_resilience() -> None:
    """Chaos 2: Network timeout during publishing is handled cleanly without unhandled exception."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    fake_post = Post(
        id=uuid.UUID(post_id),
        owner_id=uuid.UUID(user_id),
        content="Testing network timeout",
        platform="linkedin",
        status="draft",
    )

    with (
        patch("app.crud.get_post", return_value=fake_post),
        patch(
            "app.services.agentic.posting_graph.get_social_account_status",
            return_value=AccountStatusReport(
                user_id=user_id, x_connected=False, linkedin_connected=True
            ),
        ),
        patch(
            "app.services.agentic.posting_graph.dispatch_linkedin_post",
            side_effect=TimeoutError("Connection timed out after 30s"),
        ),
        patch("app.services.agentic.posting_graph._handle_publish_error"),
    ):
        report = await publish_post_with_graph(
            user_id=user_id,
            post_id=post_id,
            platform="linkedin",
        )
        assert isinstance(report, PostingGraphReport)
        assert report.status in ("failed", "error")


@pytest.mark.anyio
async def test_chaos_browser_hard_crash_during_submission() -> None:
    """Chaos 3: Browser hard crash / disconnect during X posting is shielded."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    fake_post = Post(
        id=uuid.UUID(post_id),
        owner_id=uuid.UUID(user_id),
        content="Testing browser crash",
        platform="x",
        status="draft",
    )

    with (
        patch("app.crud.get_post", return_value=fake_post),
        patch(
            "app.services.agentic.posting_graph.get_social_account_status",
            return_value=AccountStatusReport(
                user_id=user_id, x_connected=True, linkedin_connected=False
            ),
        ),
        patch(
            "app.services.agentic.posting_graph.dispatch_x_post",
            side_effect=RuntimeError("Target page, context or browser has been closed"),
        ),
        patch("app.services.agentic.posting_graph._handle_publish_error"),
    ):
        report = await publish_post_with_graph(
            user_id=user_id,
            post_id=post_id,
            platform="x",
        )
        assert isinstance(report, PostingGraphReport)
        assert report.status in ("failed", "error")


@pytest.mark.anyio
async def test_chaos_verification_graph_corrupted_post_records() -> None:
    """Chaos 4: Corrupted post records in DB do not crash VerificationGraph."""
    user_id = str(uuid.uuid4())

    with (
        patch(
            "app.services.agentic.verification_graph._load_target_posts_from_db",
            return_value=[
                {"id": "not-a-uuid", "content": None, "platform": 12345},
                {"id": str(uuid.uuid4()), "content": "Valid", "platform": "x"},
            ],
        ),
        patch(
            "app.services.agentic.verification_graph._scrape_x_profile_feed",
            new_callable=AsyncMock,
            return_value=[],
        ),
    ):
        report = await verify_posts_with_graph(
            user_id=user_id,
            platform="x",
        )
        assert isinstance(report, VerificationGraphReport)
        assert report.status in ("completed", "partial")


@pytest.mark.anyio
async def test_chaos_concurrent_multi_post_publishing() -> None:
    """Chaos 5: Concurrent invocations of publish_post_with_graph are state-isolated."""
    user_id = str(uuid.uuid4())

    async def _run_single(idx: int) -> PostingGraphReport:
        pid = str(uuid.uuid4())
        fake_p = Post(
            id=uuid.UUID(pid),
            owner_id=uuid.UUID(user_id),
            content=f"Concurrent post {idx}",
            platform="x",
            status="draft",
        )
        with (
            patch("app.crud.get_post", return_value=fake_p),
            patch(
                "app.services.agentic.posting_graph.get_social_account_status",
                return_value=AccountStatusReport(
                    user_id=user_id, x_connected=True, linkedin_connected=False
                ),
            ),
            patch(
                "app.services.agentic.posting_graph.dispatch_x_post",
                new_callable=AsyncMock,
                return_value=(True, f"182938472938{idx}", None),
            ),
            patch(
                "app.services.agentic.posting_graph.verify_posts_with_graph",
                new_callable=AsyncMock,
                return_value=VerificationGraphReport(
                    verified_post_ids=[pid], status="completed"
                ),
            ),
            patch("app.services.agentic.posting_graph._mark_as_published"),
        ):
            return await publish_post_with_graph(
                user_id=user_id,
                post_id=pid,
                platform="x",
            )

    tasks = [_run_single(i) for i in range(10)]
    results = await asyncio.gather(*tasks)

    assert len(results) == 10
    for r in results:
        assert isinstance(r, PostingGraphReport)
        assert r.status == "published"
