"""Tests for CurationGraph (Tier 2 Domain Subgraph) - Issue #87."""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.models import PostPublic
from app.services.agentic.curation_graph import (
    CurationGraphState,
    build_curation_graph,
    curate_and_draft_post,
    draft_content_node,
    gather_context_node,
    persist_draft_node,
)
from app.services.agentic.schemas import (
    AccountStatusReport,
    CuratedDraftReport,
    RefinedDraftReport,
    TopicDetailContext,
)


def _make_dummy_post_public(
    *,
    post_id: str = "33333333-3333-3333-3333-333333333333",
    user_id: str = "11111111-1111-1111-1111-111111111111",
    content: str = "Test post content",
    platform: str = "x",
) -> PostPublic:
    return PostPublic(
        id=uuid.UUID(post_id),
        owner_id=uuid.UUID(user_id),
        content=content,
        platform=platform,
        status="draft",
        method="agent",
        created_at=datetime.now(timezone.utc),
    )


@contextmanager
def patch_curation_pipeline(
    *,
    topic_ctx: Any = None,
    history: Any = None,
    account_status: Any = None,
    draft_result: Any = "Test post #AI",
    refine_result: Any = None,
    save_result: Any = None,
    draft_side_effect: Any = None,
    refine_side_effect: Any = None,
    save_side_effect: Any = None,
):
    """Context manager providing unified mock patches for CurationGraph execution."""
    default_refine = RefinedDraftReport(
        refined_content=draft_result
        if isinstance(draft_result, str)
        else "Refined post",
        is_compliant=True,
        platform="x",
        attempts=0,
        status="compliant",
    )
    mock_refine = refine_result or default_refine
    mock_status = account_status or AccountStatusReport(
        user_id="11111111-1111-1111-1111-111111111111", x_connected=True
    )
    mock_post = save_result if save_result is not None else _make_dummy_post_public()

    with (
        patch(
            "app.services.agentic.curation_graph.get_topic_tweets_and_summary",
            return_value=topic_ctx,
        ) as p_topic,
        patch(
            "app.services.agentic.curation_graph.get_recent_post_history",
            return_value=history or [],
        ) as p_history,
        patch(
            "app.services.agentic.curation_graph.get_social_account_status",
            return_value=mock_status,
        ) as p_status,
        patch(
            "app.services.agentic.curation_graph.draft_social_post",
            new_callable=AsyncMock,
            return_value=draft_result,
            side_effect=draft_side_effect,
        ) as p_draft,
        patch(
            "app.services.agentic.curation_graph.refine_draft_with_graph",
            new_callable=AsyncMock,
            return_value=mock_refine,
            side_effect=refine_side_effect,
        ) as p_refine,
        patch(
            "app.services.agentic.curation_graph.save_draft_post",
            return_value=mock_post,
            side_effect=save_side_effect,
        ) as p_save,
    ):
        yield {
            "get_topic": p_topic,
            "get_history": p_history,
            "get_status": p_status,
            "draft": p_draft,
            "refine": p_refine,
            "save": p_save,
        }


class TestCurationGraphSlices:
    """Comprehensive test suite for all vertical slices of CurationGraph."""

    @pytest.mark.anyio
    async def test_slice_1_happy_path_single_platform_draft(self) -> None:
        topic_ctx = TopicDetailContext(
            topic_id="22222222-2222-2222-2222-222222222222",
            topic_title="AI Revolution",
            summary="AI summary",
            topic_url="https://x.com/i/topics/123",
            sample_tweets=[{"author": "@dev", "text": "Agents"}],
        )
        with patch_curation_pipeline(
            topic_ctx=topic_ctx, draft_result="Agents rock #AI"
        ) as p:
            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title="AI Revolution",
                topic_id="22222222-2222-2222-2222-222222222222",
                platform="x",
                target_tone="inspiring",
            )
            assert isinstance(report, CuratedDraftReport)
            assert report.status == "persisted"
            assert report.is_compliant is True
            assert report.refined_content == "Agents rock #AI"
            p["get_topic"].assert_called_once()
            p["draft"].assert_called_once()
            p["save"].assert_called_once()

    @pytest.mark.anyio
    async def test_slice_2_oversized_draft_auto_refinement(self) -> None:
        trimmed = "L" * 250 + " #AI"
        refine_rep = RefinedDraftReport(
            refined_content=trimmed, is_compliant=True, attempts=1, status="compliant"
        )
        with patch_curation_pipeline(draft_result="L" * 350, refine_result=refine_rep):
            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title="LLM Breakthrough",
            )
            assert report.is_compliant is True
            assert report.refinement_attempts == 1
            assert len(report.refined_content) <= 280

    @pytest.mark.anyio
    async def test_slice_3_cold_start_no_topic_id(self) -> None:
        with patch_curation_pipeline() as p:
            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title="Custom Insight",
                topic_id=None,
            )
            assert report.status == "persisted"
            assert report.topic_summary is None
            p["get_topic"].assert_not_called()

    @pytest.mark.anyio
    async def test_slice_4_missing_topic_context_none_handling(self) -> None:
        with patch_curation_pipeline(topic_ctx=None) as p:
            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title="Deleted Topic",
                topic_id="99999999-9999-9999-9999-999999999999",
            )
            assert report.status == "persisted"
            assert report.topic_summary is None
            p["get_topic"].assert_called_once()

    @pytest.mark.anyio
    async def test_slice_5_llm_failure_fallback_template(self) -> None:
        with patch_curation_pipeline(draft_result="Trending: Fallback Topic."):
            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title="Fallback Topic",
            )
            assert report.draft_content == "Trending: Fallback Topic."
            assert report.status == "persisted"

    @pytest.mark.anyio
    async def test_slice_6_refine_draft_raises_exception(self) -> None:
        with patch_curation_pipeline(
            draft_result="Original draft",
            refine_side_effect=RuntimeError("LLM service down"),
        ):
            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title="Test Topic",
            )
            assert report.refined_content == "Original draft"
            assert report.is_compliant is False
            assert report.status in ("persisted", "error")

    @pytest.mark.anyio
    async def test_slice_7_save_draft_returns_none_persistence_failure(self) -> None:
        with patch_curation_pipeline(
            draft_result="Great post content #AI",
            save_result=False,
        ) as p:
            p["save"].return_value = None
            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title="DB Drop Topic",
            )
            assert report.persisted_post_id is None
            assert report.status == "error"
            assert "persist" in (report.error or "").lower()

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("platform", "is_premium", "expected_platform", "expected_premium"),
        [
            ("linkedin", False, "linkedin", False),
            ("x", True, "x", True),
        ],
    )
    async def test_platform_and_premium_propagation(
        self,
        platform: str,
        is_premium: bool,
        expected_platform: str,
        expected_premium: bool,
    ) -> None:
        status = AccountStatusReport(
            user_id="11111111-1111-1111-1111-111111111111",
            x_is_premium=is_premium,
            linkedin_connected=True,
        )
        with patch_curation_pipeline(account_status=status) as p:
            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title="Platform Test",
                platform=platform,
            )
            assert report.platform == expected_platform
            assert p["draft"].call_args.kwargs["platform"] == expected_platform
            assert p["refine"].call_args.kwargs["is_premium"] is expected_premium

    @pytest.mark.anyio
    async def test_graph_compilation_and_schema_validation(self) -> None:
        graph = build_curation_graph()
        assert graph is not None
        report = CuratedDraftReport(
            draft_content="Draft",
            refined_content="Refined",
            is_compliant=True,
            platform="x",
            status="persisted",
        )
        assert CuratedDraftReport.model_validate(report.model_dump()) == report


class TestCurationGraphNodeUnits:
    """Targeted unit tests for node-level exception handlers and edge transitions."""

    @pytest.mark.anyio
    async def test_gather_context_node_fallbacks(self) -> None:
        state: CurationGraphState = {
            "user_id": "11111111-1111-1111-1111-111111111111",
            "topic_id": "topic-123",
            "platform": "x",
        }
        with (
            patch(
                "app.services.agentic.curation_graph.get_topic_tweets_and_summary",
                side_effect=Exception("DB Error"),
            ),
            patch(
                "app.services.agentic.curation_graph.get_recent_post_history",
                side_effect=Exception("Timeout"),
            ),
            patch(
                "app.services.agentic.curation_graph.get_social_account_status",
                side_effect=Exception("Auth error"),
            ),
        ):
            out = await gather_context_node(state)
            assert out["status"] == "context_gathered"
            assert out["topic_summary"] is None
            assert out["sample_tweets"] == []
            assert out["is_premium"] is False

    @pytest.mark.anyio
    async def test_draft_content_node_blank_output(self) -> None:
        state: CurationGraphState = {"topic_title": "AI Revolution", "platform": "x"}
        with patch(
            "app.services.agentic.curation_graph.draft_social_post",
            new_callable=AsyncMock,
        ) as m:
            m.return_value = "   "
            out = await draft_content_node(state)
            assert out["draft_content"] == "Trending: AI Revolution"
            assert out["status"] == "drafted"

    @pytest.mark.anyio
    async def test_persist_draft_node_exception(self) -> None:
        state: CurationGraphState = {
            "user_id": "11111111-1111-1111-1111-111111111111",
            "refined_content": "Final content",
            "platform": "x",
        }
        with patch(
            "app.services.agentic.curation_graph.save_draft_post",
            side_effect=Exception("DB Connection Dropped"),
        ):
            out = await persist_draft_node(state)
            assert out["status"] == "error"
            assert out["persisted_post_id"] is None
            assert "DB Connection Dropped" in (out.get("error") or "")

    @pytest.mark.anyio
    async def test_curate_and_draft_post_top_level_exception(self) -> None:
        with patch(
            "app.services.agentic.curation_graph._curation_graph.ainvoke",
            side_effect=RuntimeError("Graph Crash"),
        ):
            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title="Crash Test",
            )
            assert report.status == "error"
            assert report.refined_content == "Trending: Crash Test"
            assert "Graph Crash" in (report.error or "")

    @pytest.mark.anyio
    async def test_thread_id_and_config_injection(self) -> None:
        with patch_curation_pipeline():
            with patch(
                "app.services.agentic.curation_graph._curation_graph.ainvoke",
                new_callable=AsyncMock,
            ) as mock_inv:
                mock_inv.return_value = {
                    "draft_content": "Draft",
                    "refined_content": "Refined",
                    "status": "persisted",
                }
                await curate_and_draft_post(
                    user_id="11111111-1111-1111-1111-111111111111",
                    topic_title="Thread Test",
                    thread_id="thread-custom-99",
                )
                assert (
                    mock_inv.call_args.kwargs["config"]["configurable"]["thread_id"]
                    == "thread-custom-99"
                )
