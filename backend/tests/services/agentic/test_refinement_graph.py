"""Tests for DraftRefinementGraph (Tier 1 Shared Adaptive Subgraph) - Issue #96."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from langgraph.graph import END

from app.services.agentic.refinement_graph import (
    DraftRefinementState,
    _route_after_refinement,
    _route_after_validation,
    build_draft_refinement_graph,
    refine_draft_with_feedback_node,
    refine_draft_with_graph,
    revalidate_refined_draft_node,
    validate_current_draft_node,
)
from app.services.agentic.schemas import RefinedDraftReport


async def _assert_refinement_behavior(
    *,
    initial_content: str,
    mock_result: Any,
    expected_compliant: bool,
    expected_attempts: int,
    expected_status: str,
    expected_content: str,
    platform: str = "x",
    is_premium: bool = False,
    max_attempts: int = 2,
) -> RefinedDraftReport:
    with patch(
        "app.services.agentic.refinement_graph.refine_post_draft",
        new_callable=AsyncMock,
    ) as mock_refine:
        if isinstance(mock_result, list) or isinstance(mock_result, Exception):
            mock_refine.side_effect = mock_result
        else:
            mock_refine.return_value = mock_result

        report = await refine_draft_with_graph(
            content=initial_content,
            platform=platform,
            is_premium=is_premium,
            max_attempts=max_attempts,
        )

        assert report.is_compliant is expected_compliant
        assert report.attempts == expected_attempts
        assert report.status == expected_status
        assert report.refined_content == expected_content
        return report


class TestDraftRefinementGraphSlices:
    """Comprehensive test suite for all vertical slices of DraftRefinementGraph."""

    @pytest.mark.anyio
    async def test_slice_1_already_compliant_draft(self) -> None:
        """Slice 1: Already compliant draft -> 0 attempts, instant compliant."""
        content = "Excited to share our new breakthrough in AI agents! #Tech"
        report = await refine_draft_with_graph(
            content=content,
            platform="x",
            is_premium=False,
            max_attempts=2,
        )

        assert isinstance(report, RefinedDraftReport)
        assert report.is_compliant is True
        assert report.attempts == 0
        assert report.status == "compliant"
        assert report.refined_content == content
        assert report.platform == "x"
        assert len(report.violated_constraints) == 0
        assert report.error is None

    @pytest.mark.anyio
    async def test_slice_2_single_attempt_successful_refinement(self) -> None:
        """Slice 2: Single-attempt successful refinement when draft exceeds limit."""
        refined_text = "This is a polished concise post within limits. #AI"
        report = await _assert_refinement_behavior(
            initial_content="A" * 320,
            mock_result=refined_text,
            expected_compliant=True,
            expected_attempts=1,
            expected_status="compliant",
            expected_content=refined_text,
        )
        assert len(report.violated_constraints) == 0

    @pytest.mark.anyio
    async def test_slice_3_multi_attempt_feedback_convergence(self) -> None:
        """Slice 3: Multi-attempt feedback convergence (attempt 1 fails -> attempt 2 succeeds)."""
        attempt_2_output = "Final concise tweet under 280 chars. #LinkX"
        await _assert_refinement_behavior(
            initial_content="B" * 400,
            mock_result=["B" * 300, attempt_2_output],
            expected_compliant=True,
            expected_attempts=2,
            expected_status="compliant",
            expected_content=attempt_2_output,
        )

    @pytest.mark.anyio
    async def test_slice_4_max_attempts_exhausted_best_effort(self) -> None:
        """Slice 4: Max attempts exhausted -> best-effort return, compliant=False, status='best_effort'."""
        still_long_output = "C" * 350
        report = await _assert_refinement_behavior(
            initial_content="C" * 400,
            mock_result=still_long_output,
            expected_compliant=False,
            expected_attempts=2,
            expected_status="best_effort",
            expected_content=still_long_output,
        )
        assert len(report.violated_constraints) > 0

    @pytest.mark.anyio
    async def test_slice_5_llm_exception_resilience(self) -> None:
        """Slice 5: LLM exception resilience -> returns original text, compliant=False, status='error'."""
        initial_text = "D" * 350
        report = await _assert_refinement_behavior(
            initial_content=initial_text,
            mock_result=RuntimeError("LLM API rate limit exceeded"),
            expected_compliant=False,
            expected_attempts=1,
            expected_status="error",
            expected_content=initial_text,
        )
        assert "LLM API rate limit exceeded" in (report.error or "")

    @pytest.mark.parametrize(
        ("platform", "content_len", "is_premium", "expected_compliant"),
        [
            ("linkedin", 500, False, True),  # 500 chars is within LinkedIn 3000 limit
            ("linkedin", 3500, False, False),  # 3500 exceeds LinkedIn limit
            ("x", 500, True, True),  # X Premium has 25000 char limit
            ("x", 500, False, False),  # Standard X limit is 280
            ("linkx", 150, False, True),  # Standard linkx limit 280
        ],
    )
    @pytest.mark.anyio
    async def test_slice_6_platform_and_premium_constraints(
        self,
        platform: str,
        content_len: int,
        is_premium: bool,
        expected_compliant: bool,
    ) -> None:
        """Slice 6: Platform-specific constraints (LinkedIn 3000 limit, X Premium 25000 limit)."""
        test_content = "E" * content_len
        report = await refine_draft_with_graph(
            content=test_content,
            platform=platform,
            is_premium=is_premium,
            max_attempts=0,  # 0 attempts to test deterministic validation immediately
        )

        assert report.is_compliant is expected_compliant
        assert report.attempts == 0
        if expected_compliant:
            assert report.status == "compliant"
        else:
            assert report.status == "best_effort"

    @pytest.mark.anyio
    async def test_slice_7_tone_and_explicit_violated_constraints(self) -> None:
        """Slice 7: Tone instructions and explicit violated constraints handling."""
        content = "Check out our new tool."
        target_tone = "authoritative, engaging, technical"
        violated_constraints = [
            "Tone is too casual",
            "Add call-to-action",
            "Include #DevTools hashtag",
        ]
        refined_output = "Explore our state-of-the-art engineering toolkit today! Link in bio. #DevTools"

        with patch(
            "app.services.agentic.refinement_graph.refine_post_draft",
            new_callable=AsyncMock,
        ) as mock_refine:
            mock_refine.return_value = refined_output

            report = await refine_draft_with_graph(
                content=content,
                platform="x",
                violated_constraints=violated_constraints,
                target_tone=target_tone,
                max_attempts=1,
            )

            assert report.is_compliant is True
            assert report.attempts == 1
            assert report.refined_content == refined_output
            assert mock_refine.call_count == 1

            call_instructions = mock_refine.call_args.kwargs["instructions"]
            assert "Tone is too casual" in call_instructions
            assert "Add call-to-action" in call_instructions
            assert "authoritative, engaging, technical" in call_instructions


class TestDraftRefinementUnits:
    """Unit tests for individual nodes, routing functions, and error handling."""

    @pytest.mark.anyio
    async def test_validate_current_draft_node_compliant(self) -> None:
        state: DraftRefinementState = {
            "content": "Short valid post #AI",
            "platform": "x",
            "is_premium": False,
        }
        res = await validate_current_draft_node(state)
        assert res["is_compliant"] is True
        assert res["status"] == "compliant"
        assert res["violated_constraints"] == []

    @pytest.mark.anyio
    async def test_validate_current_draft_node_with_external_violations(self) -> None:
        state: DraftRefinementState = {
            "content": "Short valid post #AI",
            "platform": "x",
            "violated_constraints": ["Missing headline"],
        }
        res = await validate_current_draft_node(state)
        assert res["is_compliant"] is False
        assert "Missing headline" in res["violated_constraints"]
        assert res["status"] == "non_compliant"

    @pytest.mark.anyio
    async def test_validate_current_draft_node_exception(self) -> None:
        with patch(
            "app.services.agentic.refinement_graph.validate_post_constraints",
            side_effect=ValueError("Unexpected constraint error"),
        ):
            state: DraftRefinementState = {"content": "Post text"}
            res = await validate_current_draft_node(state)
            assert res["is_compliant"] is False
            assert res["status"] == "error"
            assert "Unexpected constraint error" in res["error"]

    @pytest.mark.anyio
    async def test_refine_draft_with_feedback_node_empty_output_fallback(self) -> None:
        """When LLM returns empty/whitespace, node must fall back to previous content."""
        with patch(
            "app.services.agentic.refinement_graph.refine_post_draft",
            new_callable=AsyncMock,
        ) as mock_refine:
            mock_refine.return_value = "   "

            state: DraftRefinementState = {
                "content": "Original Content #1",
                "attempt": 0,
                "platform": "x",
            }
            res = await refine_draft_with_feedback_node(state)
            assert res["attempt"] == 1
            assert res["refined_content"] == "Original Content #1"
            assert res["status"] == "refined"

    @pytest.mark.anyio
    async def test_revalidate_refined_draft_node_error_state(self) -> None:
        state: DraftRefinementState = {
            "status": "error",
            "error": "Previous error",
        }
        res = await revalidate_refined_draft_node(state)
        assert res["is_compliant"] is False
        assert res["status"] == "error"

    @pytest.mark.anyio
    async def test_revalidate_refined_draft_node_exception(self) -> None:
        with patch(
            "app.services.agentic.refinement_graph.validate_post_constraints",
            side_effect=RuntimeError("Validation crash"),
        ):
            state: DraftRefinementState = {
                "refined_content": "Some text",
                "status": "refined",
            }
            res = await revalidate_refined_draft_node(state)
            assert res["is_compliant"] is False
            assert res["status"] == "error"
            assert "Validation crash" in res["error"]

    def test_route_after_validation_branches(self) -> None:
        # Error -> END
        assert _route_after_validation({"status": "error"}) == END

        # Compliant -> END
        assert (
            _route_after_validation(
                {"is_compliant": True, "attempt": 0, "max_attempts": 2}
            )
            == END
        )

        # Non-compliant, attempt < max_attempts -> refine_draft
        assert (
            _route_after_validation(
                {"is_compliant": False, "attempt": 0, "max_attempts": 2}
            )
            == "refine_draft"
        )
        assert (
            _route_after_validation(
                {"is_compliant": False, "attempt": 1, "max_attempts": 2}
            )
            == "refine_draft"
        )

        # Non-compliant, attempt >= max_attempts -> END
        assert (
            _route_after_validation(
                {"is_compliant": False, "attempt": 2, "max_attempts": 2}
            )
            == END
        )

    def test_route_after_refinement_branches(self) -> None:
        assert _route_after_refinement({"status": "error"}) == END
        assert _route_after_refinement({"status": "refined"}) == "revalidate_draft"

    def test_build_draft_refinement_graph(self) -> None:
        graph = build_draft_refinement_graph()
        assert graph is not None

    @pytest.mark.anyio
    async def test_refine_draft_graph_top_level_exception(self) -> None:
        with patch(
            "app.services.agentic.refinement_graph._draft_refinement_graph.ainvoke",
            side_effect=RuntimeError("Graph invocation crash"),
        ):
            report = await refine_draft_with_graph(
                content="Fallback test content",
                platform="x",
                violated_constraints=["Some violation"],
            )

            assert report.is_compliant is False
            assert report.status == "error"
            assert report.refined_content == "Fallback test content"
            assert "Graph invocation crash" in (report.error or "")
            assert "Some violation" in report.violated_constraints
