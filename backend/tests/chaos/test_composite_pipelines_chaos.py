"""Chaos, adversarial resilience, and concurrency tests for Composite Pipelines."""

from __future__ import annotations

import asyncio
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.agentic.publish_and_verify_pipeline import (
    run_publish_and_verify_pipeline,
)
from app.services.agentic.schemas import (
    CuratedDraftReport,
    PostingGraphReport,
    PublishAndVerifyReport,
    ScrapedBatchReport,
    TrendToDraftReport,
)
from app.services.agentic.trend_to_draft_pipeline import (
    run_trend_to_draft_pipeline,
)


@pytest.mark.parametrize(
    "adversarial_user_id",
    [
        "   ",
        "'; DROP TABLE post; --",
        "<script>alert('xss')</script>",
        "not-a-uuid-99999",
        "🚀" * 50,
    ],
)
@pytest.mark.anyio
async def test_chaos_adversarial_user_id_fuzzing(
    adversarial_user_id: str,
) -> None:
    """Chaos 1: Fuzzing with SQL injection, XSS, and invalid UUIDs never raises unhandled exception."""
    post_id = str(uuid.uuid4())

    with (
        patch(
            "app.services.agentic.trend_to_draft_pipeline.scrape_trends_with_graph",
            new_callable=AsyncMock,
            return_value=ScrapedBatchReport(scraped_topics=[], status="persisted"),
        ),
        patch(
            "app.services.agentic.publish_and_verify_pipeline.publish_post_with_graph",
            new_callable=AsyncMock,
            return_value=PostingGraphReport(
                post_id=post_id,
                platform="x",
                status="preflight_failed",
                error="Invalid user_id",
            ),
        ),
    ):
        rep1 = await run_trend_to_draft_pipeline(
            user_id=adversarial_user_id, session=MagicMock()
        )
        assert isinstance(rep1, TrendToDraftReport)
        assert rep1.status in ("empty_trends", "error")

        rep2 = await run_publish_and_verify_pipeline(
            user_id=adversarial_user_id,
            post_id=post_id,
            session=MagicMock(),
        )
        assert isinstance(rep2, PublishAndVerifyReport)
        assert rep2.status in ("posting_failed", "error")


@pytest.mark.anyio
async def test_chaos_network_timeout_cascades() -> None:
    """Chaos 2: Network timeouts during graph execution are handled cleanly."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    with (
        patch(
            "app.services.agentic.trend_to_draft_pipeline.scrape_trends_with_graph",
            side_effect=TimeoutError("Playwright navigation timeout 30000ms"),
        ),
        patch(
            "app.services.agentic.publish_and_verify_pipeline.publish_post_with_graph",
            side_effect=TimeoutError("LinkedIn HTTP request timeout 15000ms"),
        ),
    ):
        rep1 = await run_trend_to_draft_pipeline(user_id=user_id, session=MagicMock())
        assert isinstance(rep1, TrendToDraftReport)
        assert rep1.status == "error"

        rep2 = await run_publish_and_verify_pipeline(
            user_id=user_id,
            post_id=post_id,
            session=MagicMock(),
        )
        assert isinstance(rep2, PublishAndVerifyReport)
        assert rep2.status == "error"


@pytest.mark.anyio
async def test_chaos_concurrent_pipeline_executions() -> None:
    """Chaos 3: Concurrent runs across multiple users remain fully state-isolated."""
    mock_batch = ScrapedBatchReport(
        scraped_topics=[
            {"title": "Concurrent Topic 1", "id": "t1"},
            {"title": "Concurrent Topic 2", "id": "t2"},
        ],
        status="persisted",
    )

    def _mock_curate(**kw: Any) -> CuratedDraftReport:
        return CuratedDraftReport(
            draft_content="Draft",
            refined_content="Refined",
            is_compliant=True,
            topic_title=kw.get("topic_title", ""),
            persisted_post_id=str(uuid.uuid4()),
            status="persisted",
        )

    def _mock_publish(**kw: Any) -> PostingGraphReport:
        p_id = kw.get("post_id", str(uuid.uuid4()))
        return PostingGraphReport(
            post_id=p_id,
            platform="both",
            published_urls=[f"https://x.com/i/status/{p_id}"],
            is_verified=True,
            status="published",
        )

    with (
        patch(
            "app.services.agentic.trend_to_draft_pipeline.scrape_trends_with_graph",
            new_callable=AsyncMock,
            return_value=mock_batch,
        ),
        patch(
            "app.services.agentic.trend_to_draft_pipeline.curate_and_draft_post",
            new_callable=AsyncMock,
            side_effect=_mock_curate,
        ),
        patch(
            "app.services.agentic.publish_and_verify_pipeline.publish_post_with_graph",
            new_callable=AsyncMock,
            side_effect=_mock_publish,
        ),
    ):

        async def _run_single(
            _idx: int,
        ) -> tuple[TrendToDraftReport, PublishAndVerifyReport]:
            u_id = str(uuid.uuid4())
            p_id = str(uuid.uuid4())
            t_rep = await run_trend_to_draft_pipeline(user_id=u_id, session=MagicMock())
            pv_rep = await run_publish_and_verify_pipeline(
                user_id=u_id, post_id=p_id, session=MagicMock()
            )
            return t_rep, pv_rep

        tasks = [_run_single(i) for i in range(10)]
        results = await asyncio.gather(*tasks)

        assert len(results) == 10
        for t_rep, pv_rep in results:
            assert isinstance(t_rep, TrendToDraftReport)
            assert t_rep.status == "completed"
            assert len(t_rep.curated_drafts) == 2

            assert isinstance(pv_rep, PublishAndVerifyReport)
            assert pv_rep.status == "completed"
            assert pv_rep.is_published is True
