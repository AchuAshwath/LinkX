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
    @pytest.mark.parametrize(
        (
            "initial_content",
            "mock_result",
            "expected_compliant",
            "expected_attempts",
            "expected_status",
            "expected_content",
        ),
        [
            (
                "A" * 320,
                "Polished short tweet #AI",
                True,
                1,
                "compliant",
                "Polished short tweet #AI",
            ),
            (
                "B" * 400,
                ["B" * 300, "Final tweet #LinkX"],
                True,
                2,
                "compliant",
                "Final tweet #LinkX",
            ),
            (
                "C" * 400,
                "C" * 350,
                False,
                2,
                "best_effort",
                "C" * 350,
            ),
            (
                "D" * 350,
                RuntimeError("LLM API rate limit exceeded"),
                False,
                1,
                "error",
                "D" * 350,
            ),
        ],
    )
    async def test_slices_refinement_feedback_loop(
        self,
        initial_content: str,
        mock_result: Any,
        expected_compliant: bool,
        expected_attempts: int,
        expected_status: str,
        expected_content: str,
    ) -> None:
        """Slices 2-5: Test single-attempt, multi-attempt, attempt exhaustion, and error resilience."""
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
                platform="x",
                is_premium=False,
                max_attempts=2,
            )

            assert report.is_compliant is expected_compliant
            assert report.attempts == expected_attempts
            assert report.status == expected_status
            assert report.refined_content == expected_content

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
    @pytest.mark.parametrize(
        ("state_dict", "expected_compliant", "expected_status"),
        [
            (
                {
                    "content": "Short valid post #AI",
                    "platform": "x",
                    "is_premium": False,
                },
                True,
                "compliant",
            ),
            (
                {
                    "content": "Short valid post #AI",
                    "platform": "x",
                    "violated_constraints": ["Missing headline"],
                },
                False,
                "non_compliant",
            ),
        ],
    )
    async def test_validate_current_draft_node(
        self,
        state_dict: dict[str, Any],
        expected_compliant: bool,
        expected_status: str,
    ) -> None:
        res = await validate_current_draft_node(state_dict)  # type: ignore[arg-type]
        assert res["is_compliant"] is expected_compliant
        assert res["status"] == expected_status

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("node_fn", "state_dict"),
        [
            (validate_current_draft_node, {"content": "Post text"}),
            (
                revalidate_refined_draft_node,
                {"refined_content": "Some text", "status": "refined"},
            ),
        ],
    )
    async def test_nodes_exception_handling(
        self, node_fn: Any, state_dict: dict[str, Any]
    ) -> None:
        with patch(
            "app.services.agentic.refinement_graph.validate_post_constraints",
            side_effect=RuntimeError("Validation crash"),
        ):
            res = await node_fn(state_dict)
            assert res["is_compliant"] is False
            assert res["status"] == "error"
            assert "Validation crash" in res["error"]

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
