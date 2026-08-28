"""Unit and integration test suite for Tier 3 Composite Agentic Pipelines."""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.agentic.publish_and_verify_pipeline import (
    build_publish_and_verify_pipeline,
    run_publish_and_verify_pipeline,
)
from app.services.agentic.schemas import (
    CuratedDraftReport,
    PostingGraphReport,
    PublishAndVerifyReport,
    ScrapedBatchReport,
    TrendToDraftReport,
    VerificationGraphReport,
    VerificationItemReport,
)
from app.services.agentic.trend_to_draft_pipeline import (
    build_trend_to_draft_pipeline,
    run_trend_to_draft_pipeline,
)


@pytest.mark.anyio
async def test_slice_1_trend_to_draft_happy_path() -> None:
    """Slice 1: Scrapes explore trends, curates drafts for each, and persists with status='completed'."""
    user_id = str(uuid.uuid4())
    mock_batch = ScrapedBatchReport(
        scraped_topics=[
            {
                "title": "AI Agents in Production",
                "id": "t1",
                "url": "https://x.com/i/trends/1",
            },
            {
                "title": "FastAPI Async Patterns",
                "id": "t2",
                "url": "https://x.com/i/trends/2",
            },
        ],
        persisted_topic_count=2,
        status="persisted",
    )

    def _mock_curate(**kw: Any) -> CuratedDraftReport:
        t_title = kw.get("topic_title", "Topic")
        return CuratedDraftReport(
            draft_content=f"Original draft for {t_title}",
            refined_content=f"Refined draft for {t_title}",
            is_compliant=True,
            topic_title=t_title,
            persisted_post_id=str(uuid.uuid4()),
            status="persisted",
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
    ):
        report = await run_trend_to_draft_pipeline(
            user_id=user_id,
            max_topics=2,
            platform="both",
            session=MagicMock(),
        )

        assert isinstance(report, TrendToDraftReport)
        assert report.status == "completed"
        assert len(report.scraped_topics) == 2
        assert len(report.curated_drafts) == 2
        assert len(report.persisted_post_ids) == 2
        assert report.error is None


@pytest.mark.anyio
async def test_slice_2_trend_to_draft_empty_trends() -> None:
    """Slice 2: 0 trends harvested routes directly to END with status='empty_trends'."""
    user_id = str(uuid.uuid4())
    mock_batch = ScrapedBatchReport(
        scraped_topics=[],
        persisted_topic_count=0,
        status="persisted",
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
        ) as mock_curate,
    ):
        report = await run_trend_to_draft_pipeline(
            user_id=user_id,
            session=MagicMock(),
        )

        assert isinstance(report, TrendToDraftReport)
        assert report.status == "empty_trends"
        assert len(report.curated_drafts) == 0
        assert len(report.persisted_post_ids) == 0
        mock_curate.assert_not_called()


@pytest.mark.anyio
async def test_slice_3_trend_to_draft_unrecoverable_session() -> None:
    """Slice 3: ScrapingGraph unrecoverable session aborts pipeline with status='error'."""
    user_id = str(uuid.uuid4())
    mock_batch = ScrapedBatchReport(
        scraped_topics=[],
        page_state="logged_out",
        status="unrecoverable",
        error="Unrecoverable state: logged_out",
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
        ) as mock_curate,
    ):
        report = await run_trend_to_draft_pipeline(
            user_id=user_id,
            session=MagicMock(),
        )

        assert isinstance(report, TrendToDraftReport)
        assert report.status == "error"
        assert "logged_out" in str(report.error)
        mock_curate.assert_not_called()


@pytest.mark.anyio
async def test_slice_4_trend_to_draft_partial_curation_fault() -> None:
    """Slice 4: 1 of 2 topics raises exception during drafting, remaining topic succeeds."""
    user_id = str(uuid.uuid4())
    mock_batch = ScrapedBatchReport(
        scraped_topics=[
            {"title": "Failing Topic", "id": "t1", "url": "https://x.com/i/trends/1"},
            {
                "title": "Successful Topic",
                "id": "t2",
                "url": "https://x.com/i/trends/2",
            },
        ],
        persisted_topic_count=2,
        status="persisted",
    )

    def _mock_curate(**kw: Any) -> CuratedDraftReport:
        t_title = kw.get("topic_title", "")
        if t_title == "Failing Topic":
            raise RuntimeError("LLM rate limit exceeded during draft generation")
        return CuratedDraftReport(
            draft_content="Draft text",
            refined_content="Refined text",
            is_compliant=True,
            topic_title=t_title,
            persisted_post_id=str(uuid.uuid4()),
            status="persisted",
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
    ):
        report = await run_trend_to_draft_pipeline(
            user_id=user_id,
            session=MagicMock(),
        )

        assert isinstance(report, TrendToDraftReport)
        assert report.status == "partial_failure"
        assert len(report.curated_drafts) == 1
        assert len(report.persisted_post_ids) == 1


@pytest.mark.anyio
async def test_slice_5_publish_and_verify_happy_path() -> None:
    """Slice 5: Publishes across X and LinkedIn and confirms profile timeline verification."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    mock_posting = PostingGraphReport(
        post_id=post_id,
        platform="both",
        content="Published content",
        published_urls=[
            "https://www.linkedin.com/feed/update/urn:li:share:123",
            "https://x.com/i/status/456",
        ],
        is_verified=True,
        verification_report={
            "verified_post_ids": [post_id],
            "items": [{"platform": "x", "is_verified": True}],
            "status": "completed",
        },
        status="published",
    )

    with patch(
        "app.services.agentic.publish_and_verify_pipeline.publish_post_with_graph",
        new_callable=AsyncMock,
        return_value=mock_posting,
    ):
        report = await run_publish_and_verify_pipeline(
            user_id=user_id,
            post_id=post_id,
            platform="both",
            session=MagicMock(),
        )

        assert isinstance(report, PublishAndVerifyReport)
        assert report.status == "completed"
        assert report.is_published is True
        assert report.is_verified is True
        assert len(report.published_urls) == 2
        assert report.error is None


@pytest.mark.anyio
async def test_slice_6_publish_and_verify_preflight_or_posting_failure() -> None:
    """Slice 6: Posting preflight failure skips verification and returns status='posting_failed'."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    mock_posting = PostingGraphReport(
        post_id=post_id,
        platform="x",
        content="",
        status="preflight_failed",
        error="Target social accounts disconnected",
    )

    with (
        patch(
            "app.services.agentic.publish_and_verify_pipeline.publish_post_with_graph",
            new_callable=AsyncMock,
            return_value=mock_posting,
        ),
        patch(
            "app.services.agentic.publish_and_verify_pipeline.verify_posts_with_graph",
            new_callable=AsyncMock,
        ) as mock_verify,
    ):
        report = await run_publish_and_verify_pipeline(
            user_id=user_id,
            post_id=post_id,
            platform="x",
            session=MagicMock(),
        )

        assert isinstance(report, PublishAndVerifyReport)
        assert report.status == "posting_failed"
        assert report.is_published is False
        assert report.is_verified is False
        assert "disconnected" in str(report.error)
        mock_verify.assert_not_called()


@pytest.mark.anyio
async def test_slice_7_publish_and_verify_profile_verification_missing() -> None:
    """Slice 7: Post published, but timeline verification fails to locate the post."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    mock_posting = PostingGraphReport(
        post_id=post_id,
        platform="x",
        content="Testing post",
        published_urls=["https://x.com/i/status/999"],
        is_verified=False,
        verification_report=None,
        status="published",
    )

    mock_audit = VerificationGraphReport(
        verified_post_ids=[],
        unverified_post_ids=[post_id],
        items=[
            VerificationItemReport(post_id=post_id, platform="x", is_verified=False)
        ],
        status="completed",
    )

    with (
        patch(
            "app.services.agentic.publish_and_verify_pipeline.publish_post_with_graph",
            new_callable=AsyncMock,
            return_value=mock_posting,
        ),
        patch(
            "app.services.agentic.publish_and_verify_pipeline.verify_posts_with_graph",
            new_callable=AsyncMock,
            return_value=mock_audit,
        ),
    ):
        report = await run_publish_and_verify_pipeline(
            user_id=user_id,
            post_id=post_id,
            platform="x",
            session=MagicMock(),
        )

        assert isinstance(report, PublishAndVerifyReport)
        assert report.status == "partial_failure"
        assert report.is_published is True
        assert report.is_verified is False
        assert len(report.published_urls) == 1


@pytest.mark.parametrize(
    ("max_topics_in", "expected_clamped"),
    [
        (0, 1),
        (-5, 1),
        (50, 10),
        (3, 3),
    ],
)
@pytest.mark.anyio
async def test_slice_8_pipeline_parameter_reduction_and_kwargs(
    max_topics_in: int,
    expected_clamped: int,
) -> None:
    """Slice 8: Parameter boundary clamping and kwargs forwarding."""
    user_id = str(uuid.uuid4())
    captured_max_topics = None

    async def _mock_scrape(**kw: Any) -> ScrapedBatchReport:
        nonlocal captured_max_topics
        captured_max_topics = kw.get("max_topics")
        return ScrapedBatchReport(scraped_topics=[], status="persisted")

    with patch(
        "app.services.agentic.trend_to_draft_pipeline.scrape_trends_with_graph",
        new_callable=AsyncMock,
        side_effect=_mock_scrape,
    ):
        await run_trend_to_draft_pipeline(
            user_id=user_id,
            max_topics=max_topics_in,
            session=MagicMock(),
        )
        assert captured_max_topics == expected_clamped


def test_slice_9_graph_compilation_and_schema_validation() -> None:
    """Slice 9: Graph builders compile without error and schema models validate."""
    g1 = build_trend_to_draft_pipeline()
    g2 = build_publish_and_verify_pipeline()
    assert g1 is not None
    assert g2 is not None

    r1 = TrendToDraftReport(
        scraped_topics=[{"title": "Test"}],
        persisted_post_ids=["pid-1"],
        status="completed",
    )
    d1 = r1.model_dump()
    assert d1["status"] == "completed"

    r2 = PublishAndVerifyReport(
        post_id="pid-1",
        is_published=True,
        is_verified=True,
        status="completed",
    )
    d2 = r2.model_dump()
    assert d2["is_verified"] is True
