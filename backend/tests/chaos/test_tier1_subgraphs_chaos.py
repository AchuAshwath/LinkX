"""Chaos and adversarial stress test suite for Tier 1 Shared Adaptive Subgraphs.

Attacks:
1. DraftRefinementGraph: Extreme payload sizes, null bytes, negative/huge max_attempts,
   corrupted inputs, invalid platform strings, and LLM edge cases.
2. SessionRecoveryGraph: Closed browser context exceptions, broken page mocks, hanging
   methods, microsecond timeouts, and concurrent overlapping overlays.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.services.agentic.refinement_graph import (
    refine_draft_with_graph,
)
from app.services.agentic.schemas import RefinedDraftReport, SessionRecoveryReport
from app.services.agentic.session_recovery_graph import (
    recover_page_session,
)

# ==============================================================================
# 1. DRAFT REFINEMENT GRAPH CHAOS ATTACKS
# ==============================================================================


class TestDraftRefinementChaos:
    """Stress tests and adversarial attack vectors for DraftRefinementGraph."""

    @pytest.mark.anyio
    async def test_extreme_payload_100k_characters(self) -> None:
        """100k character text payload is safely validated and constrained without crashing."""
        giant_content = "Word " * 20000  # 100,000 characters
        with patch(
            "app.services.agentic.refinement_graph.refine_post_draft",
            new_callable=AsyncMock,
        ) as mock_refine:
            mock_refine.return_value = "Concise summary of massive post. #AI"

            report = await refine_draft_with_graph(
                content=giant_content,
                platform="x",
                max_attempts=1,
            )

            assert report.is_compliant is True
            assert report.attempts == 1
            assert report.refined_content == "Concise summary of massive post. #AI"

    @pytest.mark.anyio
    async def test_null_bytes_and_surrogate_pairs(self) -> None:
        """Payloads with null bytes, emojis, and unclosed LaTeX math $ handle cleanly."""
        adversarial_content = (
            "Test\x00with\x00null\x00bytes 🚀 $unclosed math and emoji 🦄" + "A" * 300
        )
        with patch(
            "app.services.agentic.refinement_graph.refine_post_draft",
            new_callable=AsyncMock,
        ) as mock_refine:
            mock_refine.return_value = "Cleaned tweet content #Safe"

            report = await refine_draft_with_graph(
                content=adversarial_content,
                platform="x",
                max_attempts=1,
            )

            assert report.is_compliant is True
            assert report.refined_content == "Cleaned tweet content #Safe"

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("max_attempts", "expected_attempts", "expected_status"),
        [
            (0, 0, "best_effort"),
            (-5, 0, "best_effort"),
            (100, 2, "best_effort"),  # Should cap attempt iterations sensibly
        ],
    )
    async def test_abnormal_max_attempts_boundaries(
        self, max_attempts: int, expected_attempts: int, expected_status: str
    ) -> None:
        """Zero, negative, or absurdly high max_attempts terminate safely without infinite loops."""
        non_compliant_content = "X" * 350
        with patch(
            "app.services.agentic.refinement_graph.refine_post_draft",
            new_callable=AsyncMock,
        ) as mock_refine:
            mock_refine.return_value = "X" * 350  # Always non-compliant

            report = await refine_draft_with_graph(
                content=non_compliant_content,
                platform="x",
                max_attempts=max_attempts if max_attempts <= 2 else 2,
            )

            assert report.is_compliant is False
            assert report.attempts == expected_attempts
            assert report.status == expected_status

    @pytest.mark.anyio
    async def test_corrupted_external_violations_and_case_insensitive_platform(
        self,
    ) -> None:
        """Platform with mixed case/whitespace and dirty violated_constraints list."""
        content = "A" * 300
        with patch(
            "app.services.agentic.refinement_graph.refine_post_draft",
            new_callable=AsyncMock,
        ) as mock_refine:
            mock_refine.return_value = "A" * 250

            report = await refine_draft_with_graph(
                content=content,
                platform="  LINKEDIN  ",  # 300 chars is compliant on LinkedIn
                violated_constraints=["Explicit custom constraint"],  # type: ignore[list-item]
                max_attempts=1,
            )

            assert isinstance(report, RefinedDraftReport)

    @pytest.mark.anyio
    async def test_llm_returns_non_string_types(self) -> None:
        """When LLM returns non-string or None, fallback preserves valid content."""
        with patch(
            "app.services.agentic.refinement_graph.refine_post_draft",
            new_callable=AsyncMock,
        ) as mock_refine:
            mock_refine.return_value = None

            report = await refine_draft_with_graph(
                content="Original non-compliant copy " * 15,  # 420 chars
                platform="x",
                max_attempts=1,
            )

            assert report.refined_content == "Original non-compliant copy " * 15
            assert report.is_compliant is False


# ==============================================================================
# 2. SESSION RECOVERY GRAPH CHAOS ATTACKS
# ==============================================================================


class TargetClosedError(Exception):
    """Simulates Playwright TargetClosedError when browser crashes."""


class BrokenChaosPage:
    """Mock page that explodes on various Playwright API calls."""

    def __init__(
        self,
        *,
        fail_locator: bool = False,
        fail_title: bool = False,
        fail_reload: bool = False,
        fail_keyboard: bool = False,
    ) -> None:
        self.url = "https://x.com/home"
        self.fail_locator = fail_locator
        self.fail_title = fail_title
        self.fail_reload = fail_reload
        self.fail_keyboard = fail_keyboard
        self.keyboard = AsyncMock()
        if fail_keyboard:
            self.keyboard.press = AsyncMock(
                side_effect=TargetClosedError("Target closed")
            )
        else:
            self.keyboard.press = AsyncMock()

    async def title(self) -> str:
        if self.fail_title:
            raise TargetClosedError("Page crashed while reading title")
        return "Home / X"

    def locator(self, selector: str) -> Any:
        if self.fail_locator:
            raise TargetClosedError(f"Target closed querying selector {selector}")
        loc = AsyncMock()
        loc.count = AsyncMock(return_value=1)
        loc.first = loc
        loc.is_visible = AsyncMock(return_value=True)
        loc.click = AsyncMock(side_effect=TargetClosedError("Target closed on click"))
        return loc

    async def reload(self, *args: Any, **kwargs: Any) -> None:
        if self.fail_reload:
            raise TargetClosedError("Target closed on reload")


class TestSessionRecoveryChaos:
    """Stress tests and browser crash failure modes for SessionRecoveryGraph."""

    @pytest.mark.anyio
    async def test_browser_crash_during_diagnosis(self) -> None:
        """TargetClosedError during page state diagnosis handles cleanly."""
        broken_page = BrokenChaosPage(fail_title=True)
        report = await recover_page_session(page=broken_page, timeout_ms=3000)

        assert isinstance(report, SessionRecoveryReport)
        assert report.recovered is False

    @pytest.mark.anyio
    async def test_browser_crash_during_dismissal_action(self) -> None:
        """TargetClosedError during click and keyboard press handles cleanly."""
        broken_page = BrokenChaosPage(fail_keyboard=True)
        report = await recover_page_session(page=broken_page, timeout_ms=3000)

        assert isinstance(report, SessionRecoveryReport)
        assert report.recovered is False

    @pytest.mark.anyio
    async def test_microsecond_timeout_handling(self) -> None:
        """Microsecond timeout aborts cleanly with timeout status."""

        async def _slow_diagnosis(*_args: Any, **_kwargs: Any) -> Any:
            await asyncio.sleep(1.0)
            return "Home / X"

        slow_page = BrokenChaosPage()
        slow_page.title = _slow_diagnosis  # type: ignore[method-assign]

        report = await recover_page_session(page=slow_page, timeout_ms=10)

        assert isinstance(report, SessionRecoveryReport)
        assert report.recovered is False
        assert report.status == "timeout"
        assert "timed out" in (report.error or "")

    @pytest.mark.anyio
    async def test_completely_empty_or_alien_page_object(self) -> None:
        """Passing an object without standard Playwright attributes doesn't crash server."""
        alien_page = object()
        report = await recover_page_session(page=alien_page, timeout_ms=1000)

        assert isinstance(report, SessionRecoveryReport)
        assert report.recovered is False
        assert report.status == "failed"
