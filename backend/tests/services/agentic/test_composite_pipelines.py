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


@pytest.mark.parametrize(
    "case",
    [
        {
            "topics": [
                {"title": "AI Agents in Production", "id": "t1"},
                {"title": "FastAPI Async Patterns", "id": "t2"},
            ],
            "batch_status": "persisted",
            "page_state": "ok",
            "scrape_err": None,
            "curate_err_on": None,
            "expected_status": "completed",
            "expected_draft_count": 2,
            "expected_id_count": 2,
        },
        {
            "topics": [],
            "batch_status": "persisted",
            "page_state": "ok",
            "scrape_err": None,
            "curate_err_on": None,
            "expected_status": "empty_trends",
            "expected_draft_count": 0,
            "expected_id_count": 0,
        },
        {
            "topics": [],
            "batch_status": "unrecoverable",
            "page_state": "logged_out",
            "scrape_err": "Unrecoverable state: logged_out",
            "curate_err_on": None,
            "expected_status": "error",
            "expected_draft_count": 0,
            "expected_id_count": 0,
        },
        {
            "topics": [
                {"title": "Failing Topic", "id": "t1"},
                {"title": "Successful Topic", "id": "t2"},
            ],
            "batch_status": "persisted",
            "page_state": "ok",
            "scrape_err": None,
            "curate_err_on": "Failing Topic",
            "expected_status": "partial_failure",
            "expected_draft_count": 1,
            "expected_id_count": 1,
        },
    ],
)
@pytest.mark.anyio
async def test_trend_to_draft_scenarios(case: dict[str, Any]) -> None:
    """Validate all execution branches of AutonomousTrendToDraftPipeline."""
    user_id = str(uuid.uuid4())
    mock_batch = ScrapedBatchReport(
        scraped_topics=case["topics"],
        persisted_topic_count=len(case["topics"]),
        page_state=case["page_state"],
        status=case["batch_status"],
        error=case["scrape_err"],
    )

    def _mock_curate(**kw: Any) -> CuratedDraftReport:
        t_title = kw.get("topic_title", "Topic")
        if case["curate_err_on"] and t_title == case["curate_err_on"]:
            raise RuntimeError("LLM rate limit exceeded during draft generation")
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
            max_topics=len(case["topics"]) or 3,
            platform="both",
            session=MagicMock(),
        )

        assert isinstance(report, TrendToDraftReport)
        assert report.status == case["expected_status"]
        assert len(report.curated_drafts) == case["expected_draft_count"]
        assert len(report.persisted_post_ids) == case["expected_id_count"]


@pytest.mark.parametrize(
    "case",
    [
        {
            "post_status": "published",
            "is_pub": True,
            "post_verified": True,
            "urls": [
                "https://x.com/i/status/123",
                "https://www.linkedin.com/feed/update/urn:li:share:456",
            ],
            "err": None,
            "audit_rep": None,
            "expected_status": "completed",
            "expected_is_pub": True,
            "expected_is_ver": True,
        },
        {
            "post_status": "preflight_failed",
            "is_pub": False,
            "post_verified": False,
            "urls": [],
            "err": "Target social accounts disconnected",
            "audit_rep": None,
            "expected_status": "posting_failed",
            "expected_is_pub": False,
            "expected_is_ver": False,
        },
        {
            "post_status": "published",
            "is_pub": True,
            "post_verified": False,
            "urls": ["https://x.com/i/status/999"],
            "err": None,
            "audit_rep": VerificationGraphReport(
                verified_post_ids=[],
                unverified_post_ids=["test-pid"],
                items=[
                    VerificationItemReport(
                        post_id="test-pid", platform="x", is_verified=False
                    )
                ],
                status="completed",
            ),
            "expected_status": "partial_failure",
            "expected_is_pub": True,
            "expected_is_ver": False,
        },
    ],
)
@pytest.mark.anyio
async def test_publish_and_verify_scenarios(case: dict[str, Any]) -> None:
    """Validate all execution branches of AutonomousPublishAndVerifyPipeline."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    mock_posting = PostingGraphReport(
        post_id=post_id,
        platform="both",
        content="Published content",
        published_urls=case["urls"],
        is_verified=case["post_verified"],
        status=case["post_status"],
        error=case["err"],
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
            return_value=case["audit_rep"],
        ),
    ):
        report = await run_publish_and_verify_pipeline(
            user_id=user_id,
            post_id=post_id,
            platform="both",
            session=MagicMock(),
        )

        assert isinstance(report, PublishAndVerifyReport)
        assert report.status == case["expected_status"]
        assert report.is_published is case["expected_is_pub"]
        assert report.is_verified is case["expected_is_ver"]
        assert len(report.published_urls) == len(case["urls"])


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
async def test_pipeline_parameter_reduction_and_kwargs(
    max_topics_in: int,
    expected_clamped: int,
) -> None:
    """Validate parameter boundary clamping and kwargs forwarding."""
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


def test_pipeline_graph_compilation_and_schema_validation() -> None:
    """Validate graph builders compile without error and schema models validate."""
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
