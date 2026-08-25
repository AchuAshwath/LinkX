"""Tests for Curation and Diagnostics Agentic Tools."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.agentic.tools.curation_tools import (
    draft_social_post,
    refine_post_draft,
    validate_post_constraints,
)
from app.services.agentic.tools.diagnostics_tools import (
    inspect_dom_snippet,
    probe_and_patch_broken_selector,
    trigger_autonomous_selector_healing,
)


class TestCurationTools:
    @pytest.mark.anyio
    async def test_draft_social_post(self) -> None:
        with patch(
            "app.services.agentic.tools.curation_tools.generate_ai_post_draft",
            return_value="Autonomous agents are changing the software landscape. #AI",
        ) as mock_draft:
            res = await draft_social_post(
                topic_title="AI Agents in Production",
                topic_summary="Frameworks for self-healing automation",
                platform="x",
            )
            assert "Autonomous agents" in res
            mock_draft.assert_called_once()

    def test_validate_post_constraints_compliant(self) -> None:
        report = validate_post_constraints(
            content="Building in public with clean architecture and self-healing tools! #BuildInPublic",
            platform="x",
            is_premium=False,
        )
        assert report.is_compliant is True
        assert report.char_count > 0
        assert report.max_limit == 280

    def test_validate_post_constraints_exceeded(self) -> None:
        giant_content = "Word " * 100
        report = validate_post_constraints(
            content=giant_content,
            platform="x",
            is_premium=False,
        )
        assert report.is_compliant is False
        assert len(report.violations) >= 1
        assert "exceeds" in report.violations[0]

    @pytest.mark.anyio
    async def test_refine_post_draft(self) -> None:
        with patch(
            "app.services.agentic.tools.curation_tools.generate_ai_post_draft",
            return_value="Short punchy take. #Tech",
        ):
            res = await refine_post_draft(
                content="Long wordy draft that needs trimming",
                platform="x",
                instructions="Shorten to under 30 chars",
            )
            assert res == "Short punchy take. #Tech"


class TestDiagnosticsTools:
    @pytest.mark.anyio
    async def test_inspect_dom_snippet(self) -> None:
        mock_page = AsyncMock()
        mock_page.url = "https://x.com/home"
        mock_context = AsyncMock()
        mock_context.pages = [mock_page]

        with (
            patch(
                "app.services.agentic.tools.diagnostics_tools.BrowserManager"
            ) as mock_bm_cls,
            patch(
                "app.services.agentic.tools.diagnostics_tools.get_dom_snippet",
                new_callable=AsyncMock,
            ) as mock_dom,
            patch(
                "app.services.agentic.tools.diagnostics_tools.detect_page_state",
                new_callable=AsyncMock,
            ) as mock_state,
        ):
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = True
            mock_bm.get_context.return_value.__aenter__.return_value = mock_context
            mock_bm_cls.return_value = mock_bm
            mock_state.return_value = "ok"
            mock_dom.return_value = "<div data-testid='trend'>#AI</div>"

            res = await inspect_dom_snippet(user_id="user-123", max_chars=500)
            assert res["success"] is True
            assert "#AI" in res["dom_snippet"]

    @pytest.mark.anyio
    async def test_probe_and_patch_broken_selector(self) -> None:
        mock_page = AsyncMock()
        mock_context = AsyncMock()
        mock_context.pages = [mock_page]

        with (
            patch(
                "app.services.agentic.tools.diagnostics_tools.BrowserManager"
            ) as mock_bm_cls,
            patch(
                "app.services.agentic.tools.diagnostics_tools.validate_selector_candidate",
                new_callable=AsyncMock,
            ) as mock_val,
            patch(
                "app.services.agentic.tools.diagnostics_tools.patch_selector_config",
                return_value=True,
            ),
        ):
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = True
            mock_bm.get_context.return_value.__aenter__.return_value = mock_context
            mock_bm_cls.return_value = mock_bm
            mock_val.return_value = {"found": True, "visible": True}

            res = await probe_and_patch_broken_selector(
                user_id="user-123",
                selector_key="sidebar.trend",
                candidate_selector="div.trend_new",
            )
            assert res["success"] is True

    @pytest.mark.anyio
    async def test_trigger_autonomous_selector_healing(self) -> None:
        mock_page = AsyncMock()
        mock_context = AsyncMock()
        mock_context.pages = [mock_page]

        with (
            patch(
                "app.services.agentic.tools.diagnostics_tools.BrowserManager"
            ) as mock_bm_cls,
            patch(
                "app.services.agentic.tools.diagnostics_tools.heal_selector",
                new_callable=AsyncMock,
            ) as mock_heal,
        ):
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = True
            mock_bm.get_context.return_value.__aenter__.return_value = mock_context
            mock_bm_cls.return_value = mock_bm
            mock_heal.return_value = "div[data-testid='trend_new']"

            res = await trigger_autonomous_selector_healing(
                user_id="user-123",
                failed_selector_key="sidebar.trend",
            )
            assert res["success"] is True
            assert res["healed_selector"] == "div[data-testid='trend_new']"
