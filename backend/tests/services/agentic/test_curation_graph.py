"""Tests for CurationGraph (Tier 2 Domain Subgraph) - Issue #87."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
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
    refine_copy_node,
)
from app.services.agentic.schemas import (
    AccountStatusReport,
    CuratedDraftReport,
    RefinedDraftReport,
    TopicDetailContext,
)


def _make_dummy_post_public(
    *,
    post_id: str | None = None,
    user_id: str = "11111111-1111-1111-1111-111111111111",
    content: str = "Test post content",
    platform: str = "x",
) -> PostPublic:
    return PostPublic(
        id=uuid.UUID(post_id or "33333333-3333-3333-3333-333333333333"),
        owner_id=uuid.UUID(user_id),
        content=content,
        platform=platform,
        status="draft",
        method="agent",
        created_at=datetime.now(timezone.utc),
    )


class TestCurationGraphSlices:
    """Comprehensive test suite for all 10 vertical slices of CurationGraph."""

    @pytest.mark.anyio
    async def test_slice_1_happy_path_single_platform_draft(self) -> None:
        """Slice 1: Happy path single-platform draft with full context and successful persistence."""
        user_id = "11111111-1111-1111-1111-111111111111"
        topic_id = "22222222-2222-2222-2222-222222222222"
        topic_title = "AI Agent Revolution"
        topic_summary = "AI agents are transforming modern development workflows."
        draft_text = (
            "Autonomous AI agents are here to revolutionize software! #AI #Tech"
        )
        dummy_post = _make_dummy_post_public(user_id=user_id, content=draft_text)

        mock_topic_ctx = TopicDetailContext(
            topic_id=topic_id,
            topic_title=topic_title,
            summary=topic_summary,
            topic_url="https://x.com/i/topics/123",
            sample_tweets=[{"author": "@dev", "text": "Agents are cool"}],
        )
        mock_account_status = AccountStatusReport(
            user_id=user_id,
            x_connected=True,
            x_is_premium=False,
        )
        mock_refined_report = RefinedDraftReport(
            refined_content=draft_text,
            is_compliant=True,
            platform="x",
            attempts=0,
            status="compliant",
            compliance_report={"char_count": len(draft_text), "max_limit": 280},
        )

        with (
            patch(
                "app.services.agentic.curation_graph.get_topic_tweets_and_summary",
                return_value=mock_topic_ctx,
            ) as mock_get_topic,
            patch(
                "app.services.agentic.curation_graph.get_recent_post_history",
                return_value=[],
            ) as mock_get_history,
            patch(
                "app.services.agentic.curation_graph.get_social_account_status",
                return_value=mock_account_status,
            ) as mock_get_status,
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                return_value=draft_text,
            ) as mock_draft,
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=mock_refined_report,
            ) as mock_refine,
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                return_value=dummy_post,
            ) as mock_save,
        ):
            report = await curate_and_draft_post(
                user_id=user_id,
                topic_title=topic_title,
                topic_id=topic_id,
                platform="x",
                target_tone="inspiring",
            )

            assert isinstance(report, CuratedDraftReport)
            assert report.status == "persisted"
            assert report.persisted_post_id == str(dummy_post.id)
            assert report.is_compliant is True
            assert report.refined_content == draft_text
            assert report.draft_content == draft_text
            assert report.topic_title == topic_title
            assert report.topic_summary == topic_summary
            assert report.refinement_attempts == 0
            assert report.error is None

            mock_get_topic.assert_called_once_with(topic_id=topic_id, session=None)
            mock_get_history.assert_called_once_with(
                user_id=user_id, platform="x", limit=3, session=None
            )
            mock_get_status.assert_called_once_with(user_id=user_id, session=None)
            mock_draft.assert_called_once_with(
                topic_title=topic_title,
                topic_summary=topic_summary,
                platform="x",
                tone="inspiring",
            )
            mock_refine.assert_called_once_with(
                content=draft_text,
                platform="x",
                is_premium=False,
                target_tone="inspiring",
            )
            mock_save.assert_called_once_with(
                user_id=user_id,
                content=draft_text,
                platform="x",
                session=None,
            )

    @pytest.mark.anyio
    async def test_slice_2_oversized_draft_auto_refinement(self) -> None:
        """Slice 2: Oversized draft is iteratively trimmed and refined by the refinement subgraph."""
        user_id = "11111111-1111-1111-1111-111111111111"
        topic_title = "Large Language Models Breakthrough"
        long_draft = "L" * 350
        trimmed_draft = "L" * 250 + " #AI"
        dummy_post = _make_dummy_post_public(user_id=user_id, content=trimmed_draft)

        mock_refined_report = RefinedDraftReport(
            refined_content=trimmed_draft,
            is_compliant=True,
            platform="x",
            attempts=1,
            status="compliant",
            compliance_report={"char_count": len(trimmed_draft), "max_limit": 280},
        )

        with (
            patch(
                "app.services.agentic.curation_graph.get_topic_tweets_and_summary",
                return_value=None,
            ),
            patch(
                "app.services.agentic.curation_graph.get_recent_post_history",
                return_value=[],
            ),
            patch(
                "app.services.agentic.curation_graph.get_social_account_status",
                return_value=AccountStatusReport(user_id=user_id, x_is_premium=False),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                return_value=long_draft,
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=mock_refined_report,
            ) as mock_refine,
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                return_value=dummy_post,
            ) as mock_save,
        ):
            report = await curate_and_draft_post(
                user_id=user_id,
                topic_title=topic_title,
                platform="x",
            )

            assert report.is_compliant is True
            assert report.refinement_attempts == 1
            assert report.draft_content == long_draft
            assert report.refined_content == trimmed_draft
            assert report.persisted_post_id == str(dummy_post.id)

            mock_refine.assert_called_once_with(
                content=long_draft,
                platform="x",
                is_premium=False,
                target_tone=None,
            )
            # Ensure the refined content, not the raw long draft, was saved
            mock_save.assert_called_once_with(
                user_id=user_id,
                content=trimmed_draft,
                platform="x",
                session=None,
            )

    @pytest.mark.anyio
    async def test_slice_3_cold_start_no_topic_id(self) -> None:
        """Slice 3: Cold start where topic_id is None -> bypasses topic tweets retrieval."""
        user_id = "11111111-1111-1111-1111-111111111111"
        topic_title = "Python 3.13 Innovations"
        draft_text = "Python 3.13 introduces free-threaded CPython and JIT! #Python"
        dummy_post = _make_dummy_post_public(user_id=user_id, content=draft_text)

        with (
            patch(
                "app.services.agentic.curation_graph.get_topic_tweets_and_summary"
            ) as mock_get_topic,
            patch(
                "app.services.agentic.curation_graph.get_recent_post_history",
                return_value=[],
            ),
            patch(
                "app.services.agentic.curation_graph.get_social_account_status",
                return_value=AccountStatusReport(user_id=user_id),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                return_value=draft_text,
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content=draft_text,
                    is_compliant=True,
                    platform="x",
                ),
            ),
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                return_value=dummy_post,
            ),
        ):
            report = await curate_and_draft_post(
                user_id=user_id,
                topic_title=topic_title,
                topic_id=None,
                platform="x",
            )

            assert report.status == "persisted"
            assert report.topic_summary is None
            assert report.refined_content == draft_text
            mock_get_topic.assert_not_called()

    @pytest.mark.anyio
    async def test_slice_4_topic_summary_returns_none(self) -> None:
        """Slice 4: get_topic_tweets_and_summary returns None -> graceful fallback to empty context."""
        user_id = "11111111-1111-1111-1111-111111111111"
        topic_title = "Unknown Topic"
        draft_text = "Talking about an unknown topic! #News"
        dummy_post = _make_dummy_post_public(user_id=user_id, content=draft_text)

        with (
            patch(
                "app.services.agentic.curation_graph.get_topic_tweets_and_summary",
                return_value=None,
            ) as mock_get_topic,
            patch(
                "app.services.agentic.curation_graph.get_recent_post_history",
                return_value=[],
            ),
            patch(
                "app.services.agentic.curation_graph.get_social_account_status",
                return_value=AccountStatusReport(user_id=user_id),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                return_value=draft_text,
            ) as mock_draft,
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content=draft_text,
                    is_compliant=True,
                    platform="x",
                ),
            ),
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                return_value=dummy_post,
            ),
        ):
            report = await curate_and_draft_post(
                user_id=user_id,
                topic_title=topic_title,
                topic_id="non-existent-uuid",
                platform="x",
            )

            assert report.status == "persisted"
            assert report.topic_summary is None
            mock_get_topic.assert_called_once_with(
                topic_id="non-existent-uuid", session=None
            )
            mock_draft.assert_called_once_with(
                topic_title=topic_title,
                topic_summary=None,
                platform="x",
                tone=None,
            )

    @pytest.mark.anyio
    async def test_slice_5_llm_drafting_failure_fallback(self) -> None:
        """Slice 5: LLM drafting failure triggers deterministic fallback template."""
        user_id = "11111111-1111-1111-1111-111111111111"
        topic_title = "Quantum Computing Update"
        fallback_expected = f"Trending: {topic_title}"
        dummy_post = _make_dummy_post_public(user_id=user_id, content=fallback_expected)

        with (
            patch(
                "app.services.agentic.curation_graph.get_topic_tweets_and_summary",
                return_value=None,
            ),
            patch(
                "app.services.agentic.curation_graph.get_recent_post_history",
                return_value=[],
            ),
            patch(
                "app.services.agentic.curation_graph.get_social_account_status",
                return_value=AccountStatusReport(user_id=user_id),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                side_effect=RuntimeError("LLM API rate limit exceeded"),
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content=fallback_expected,
                    is_compliant=True,
                    platform="x",
                ),
            ),
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                return_value=dummy_post,
            ) as mock_save,
        ):
            report = await curate_and_draft_post(
                user_id=user_id,
                topic_title=topic_title,
                platform="x",
            )

            assert report.draft_content == fallback_expected
            assert report.refined_content == fallback_expected
            assert report.persisted_post_id == str(dummy_post.id)
            mock_save.assert_called_once_with(
                user_id=user_id,
                content=fallback_expected,
                platform="x",
                session=None,
            )

    @pytest.mark.anyio
    async def test_slice_6_refine_draft_exception_shielding(self) -> None:
        """Slice 6: Exception in refine_draft_with_graph is caught and preserves draft content."""
        user_id = "11111111-1111-1111-1111-111111111111"
        topic_title = "Cybersecurity Alert"
        draft_text = "Important security patch released today. #CyberSecurity"
        dummy_post = _make_dummy_post_public(user_id=user_id, content=draft_text)

        with (
            patch(
                "app.services.agentic.curation_graph.get_topic_tweets_and_summary",
                return_value=None,
            ),
            patch(
                "app.services.agentic.curation_graph.get_recent_post_history",
                return_value=[],
            ),
            patch(
                "app.services.agentic.curation_graph.get_social_account_status",
                return_value=AccountStatusReport(user_id=user_id),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                return_value=draft_text,
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                side_effect=RuntimeError("Refinement graph service crashed"),
            ),
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                return_value=dummy_post,
            ) as mock_save,
        ):
            report = await curate_and_draft_post(
                user_id=user_id,
                topic_title=topic_title,
                platform="x",
            )

            assert report.refined_content == draft_text
            assert report.is_compliant is False
            assert report.persisted_post_id == str(dummy_post.id)
            assert "Refinement graph service crashed" in (report.error or "")

            mock_save.assert_called_once_with(
                user_id=user_id,
                content=draft_text,
                platform="x",
                session=None,
            )

    @pytest.mark.anyio
    async def test_slice_7_save_draft_db_failure(self) -> None:
        """Slice 7: Database persistence returning None results in status='error' and persisted_post_id=None."""
        user_id = "11111111-1111-1111-1111-111111111111"
        topic_title = "SpaceX Launch"
        draft_text = "Exciting launch scheduled for tomorrow! #SpaceX"

        with (
            patch(
                "app.services.agentic.curation_graph.get_topic_tweets_and_summary",
                return_value=None,
            ),
            patch(
                "app.services.agentic.curation_graph.get_recent_post_history",
                return_value=[],
            ),
            patch(
                "app.services.agentic.curation_graph.get_social_account_status",
                return_value=AccountStatusReport(user_id=user_id),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                return_value=draft_text,
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content=draft_text,
                    is_compliant=True,
                    platform="x",
                ),
            ),
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                return_value=None,
            ),
        ):
            report = await curate_and_draft_post(
                user_id=user_id,
                topic_title=topic_title,
                platform="x",
            )

            assert report.status == "error"
            assert report.persisted_post_id is None
            assert "Failed to persist draft to database" in (report.error or "")

    @pytest.mark.anyio
    async def test_slice_8_linkedin_platform_propagation(self) -> None:
        """Slice 8: LinkedIn platform is propagated across all context, drafting, refinement, and persistence."""
        user_id = "11111111-1111-1111-1111-111111111111"
        topic_title = "Enterprise Architecture Patterns"
        li_draft = "Comprehensive breakdown of clean enterprise architecture.\n\nKey takeaways:\n1. Loose coupling\n2. High cohesion\n\n#SoftwareEngineering"
        dummy_post = _make_dummy_post_public(
            user_id=user_id, content=li_draft, platform="linkedin"
        )

        with (
            patch(
                "app.services.agentic.curation_graph.get_topic_tweets_and_summary",
                return_value=None,
            ),
            patch(
                "app.services.agentic.curation_graph.get_recent_post_history",
                return_value=[],
            ) as mock_get_history,
            patch(
                "app.services.agentic.curation_graph.get_social_account_status",
                return_value=AccountStatusReport(
                    user_id=user_id, linkedin_connected=True
                ),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                return_value=li_draft,
            ) as mock_draft,
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content=li_draft,
                    is_compliant=True,
                    platform="linkedin",
                ),
            ) as mock_refine,
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                return_value=dummy_post,
            ) as mock_save,
        ):
            report = await curate_and_draft_post(
                user_id=user_id,
                topic_title=topic_title,
                platform="linkedin",
                target_tone="professional",
            )

            assert report.platform == "linkedin"
            assert report.status == "persisted"
            mock_get_history.assert_called_once_with(
                user_id=user_id, platform="linkedin", limit=3, session=None
            )
            mock_draft.assert_called_once_with(
                topic_title=topic_title,
                topic_summary=None,
                platform="linkedin",
                tone="professional",
            )
            mock_refine.assert_called_once_with(
                content=li_draft,
                platform="linkedin",
                is_premium=False,
                target_tone="professional",
            )
            mock_save.assert_called_once_with(
                user_id=user_id,
                content=li_draft,
                platform="linkedin",
                session=None,
            )

    @pytest.mark.anyio
    async def test_slice_9_x_premium_propagation(self) -> None:
        """Slice 9: X premium status is detected and propagated to refinement subgraph."""
        user_id = "11111111-1111-1111-1111-111111111111"
        topic_title = "Long Form Analysis"
        long_tweet = "P" * 1200
        dummy_post = _make_dummy_post_public(user_id=user_id, content=long_tweet)

        with (
            patch(
                "app.services.agentic.curation_graph.get_topic_tweets_and_summary",
                return_value=None,
            ),
            patch(
                "app.services.agentic.curation_graph.get_recent_post_history",
                return_value=[],
            ),
            patch(
                "app.services.agentic.curation_graph.get_social_account_status",
                return_value=AccountStatusReport(
                    user_id=user_id, x_connected=True, x_is_premium=True
                ),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                return_value=long_tweet,
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content=long_tweet,
                    is_compliant=True,
                    platform="x",
                ),
            ) as mock_refine,
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                return_value=dummy_post,
            ),
        ):
            report = await curate_and_draft_post(
                user_id=user_id,
                topic_title=topic_title,
                platform="x",
            )

            assert report.is_compliant is True
            mock_refine.assert_called_once_with(
                content=long_tweet,
                platform="x",
                is_premium=True,
                target_tone=None,
            )

    @pytest.mark.anyio
    async def test_slice_10_graph_compilation_and_schema_validation(self) -> None:
        """Slice 10: Graph builder compilation and CuratedDraftReport schema defaults/serialization."""
        graph = build_curation_graph()
        assert graph is not None

        # Test report model serialization and defaults
        report = CuratedDraftReport(
            draft_content="Raw draft",
            refined_content="Refined draft",
        )
        assert report.platform == "x"
        assert report.is_compliant is False
        assert report.refinement_attempts == 0
        assert report.status == "persisted"
        assert report.persisted_post_id is None
        assert report.topic_title == ""
        assert report.topic_summary is None

        data = report.model_dump()
        assert data["draft_content"] == "Raw draft"
        assert data["refined_content"] == "Refined draft"
        assert data["platform"] == "x"


class TestCurationGraphUnits:
    """Unit tests for individual nodes and error edge cases."""

    @pytest.mark.anyio
    async def test_gather_context_node_partial_failures(self) -> None:
        """Test gather_context_node when individual helper functions throw exceptions."""
        state: CurationGraphState = {
            "user_id": "test-user",
            "topic_id": "bad-topic",
            "platform": "x",
        }

        with (
            patch(
                "app.services.agentic.curation_graph.get_topic_tweets_and_summary",
                side_effect=RuntimeError("Topic query failed"),
            ),
            patch(
                "app.services.agentic.curation_graph.get_recent_post_history",
                side_effect=RuntimeError("Post history query failed"),
            ),
            patch(
                "app.services.agentic.curation_graph.get_social_account_status",
                side_effect=RuntimeError("Account status query failed"),
            ),
        ):
            res = await gather_context_node(state)
            assert res["status"] == "context_gathered"
            assert res["topic_summary"] is None
            assert res["sample_tweets"] == []
            assert res["recent_posts"] == []
            assert res["is_premium"] is False

    @pytest.mark.anyio
    async def test_draft_content_node_empty_output_fallback(self) -> None:
        """Test draft_content_node when LLM returns empty/whitespace string."""
        state: CurationGraphState = {
            "topic_title": "AI Trends",
            "platform": "x",
        }
        with patch(
            "app.services.agentic.curation_graph.draft_social_post",
            new_callable=AsyncMock,
            return_value="   ",
        ):
            res = await draft_content_node(state)
            assert res["draft_content"] == "Trending: AI Trends"
            assert res["status"] == "drafted"

    @pytest.mark.anyio
    async def test_refine_copy_node_error_branch(self) -> None:
        """Test refine_copy_node exception handling branch."""
        state: CurationGraphState = {
            "draft_content": "Initial Draft",
            "topic_title": "AI Trends",
            "platform": "x",
        }
        with patch(
            "app.services.agentic.curation_graph.refine_draft_with_graph",
            new_callable=AsyncMock,
            side_effect=RuntimeError("Refinement crash"),
        ):
            res = await refine_copy_node(state)
            assert res["refined_content"] == "Initial Draft"
            assert res["is_compliant"] is False
            assert res["status"] == "error"
            assert "Refinement crash" in res["error"]

    @pytest.mark.anyio
    async def test_persist_draft_node_exception(self) -> None:
        """Test persist_draft_node when save_draft_post raises an exception."""
        state: CurationGraphState = {
            "user_id": "user-1",
            "refined_content": "Final content",
            "platform": "x",
        }
        with patch(
            "app.services.agentic.curation_graph.save_draft_post",
            side_effect=RuntimeError("DB Connection dropped"),
        ):
            res = await persist_draft_node(state)
            assert res["persisted_post_id"] is None
            assert res["status"] == "error"
            assert "DB Connection dropped" in res["error"]

    @pytest.mark.anyio
    async def test_curate_and_draft_post_top_level_exception(self) -> None:
        """Test curate_and_draft_post when graph.ainvoke throws an unhandled exception."""
        with patch(
            "app.services.agentic.curation_graph._curation_graph.ainvoke",
            side_effect=RuntimeError("Graph engine failure"),
        ):
            report = await curate_and_draft_post(
                user_id="user-1",
                topic_title="Catastrophic Failure Test",
                platform="x",
            )
            assert report.status == "error"
            assert report.is_compliant is False
            assert report.persisted_post_id is None
            assert "Graph engine failure" in (report.error or "")
            assert report.refined_content == "Trending: Catastrophic Failure Test"

    @pytest.mark.anyio
    async def test_curate_and_draft_post_thread_id_and_config_injection(self) -> None:
        """Test thread_id and config parameter injection into LangGraph execution."""
        mock_invoke = AsyncMock(
            return_value={
                "draft_content": "Draft",
                "refined_content": "Refined",
                "is_compliant": True,
                "refinement_attempts": 0,
                "persisted_post_id": "123",
                "status": "persisted",
            }
        )
        with patch(
            "app.services.agentic.curation_graph._curation_graph.ainvoke",
            mock_invoke,
        ):
            await curate_and_draft_post(
                user_id="user-1",
                topic_title="Config Test",
                thread_id="test-thread-42",
                config={"tags": ["curation-run"]},
            )

            mock_invoke.assert_called_once()
            called_config = mock_invoke.call_args.kwargs["config"]
            assert called_config["tags"] == ["curation-run"]
            assert called_config["configurable"]["thread_id"] == "test-thread-42"
