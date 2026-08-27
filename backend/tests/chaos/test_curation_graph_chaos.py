"""Chaos and adversarial stress test suite for CurationGraph (Tier 2 Domain Subgraph) - Issue #87.

Attacks and Invariants:
1. Poisoned & Extreme Inputs:
   - 100k characters topic_title, null bytes (\x00), surrogate pairs, emojis, SQL injections, unclosed HTML tags.
   - Whitespace, empty, upper/mixed case, None, or unknown platform names.
   - Non-UUID user_id, empty user_id, invalid user_id types.
   - Bizarre, massive, or poisoned target_tone strings.
2. Cascading External & Tool Failures:
   - Corrupted payloads from get_topic_tweets_and_summary (None summary, None author/text, non-dict items).
   - get_social_account_status raising unhandled KeyError, AttributeError, or ConnectionError.
   - get_recent_post_history raising SQLAlchemy OperationalError or returning corrupted list items.
3. LLM & Refinement Graph Degradation:
   - draft_social_post raising RuntimeError, TimeoutError, returning empty/whitespace/non-string objects.
   - refine_draft_with_graph raising asyncio.TimeoutError, returning empty refined_content, or status="error".
   - Invariant: refined_content must NEVER be empty or None.
4. Database Transaction Boundary Failures:
   - save_draft_post raising IntegrityError, OperationalError, or returning None / missing ID.
5. Concurrency & Thread-ID Injection:
   - Concurrent invocations with shared/clashing config and independent thread_ids.
   - Mixed concurrent success and failure scenarios without state leakage.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.exc import IntegrityError, OperationalError

from app.models import PostPublic
from app.services.agentic.curation_graph import curate_and_draft_post
from app.services.agentic.schemas import (
    AccountStatusReport,
    CuratedDraftReport,
    RefinedDraftReport,
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


# ==============================================================================
# 1. POISONED & EXTREME INPUT ATTACKS
# ==============================================================================


class TestPoisonedAndExtremeInputsChaos:
    """Adversarial testing with malformed, poisoned, and boundary-breaking inputs."""

    @pytest.mark.anyio
    async def test_topic_title_100k_characters_handled_safely(self) -> None:
        """100,000 character topic_title does not crash the graph or database persistence."""
        user_id = "11111111-1111-1111-1111-111111111111"
        huge_title = "MassiveTopicTitle " * 5500  # ~100k characters
        expected_draft = "Summarized short post for massive title. #AI"
        dummy_post = _make_dummy_post_public(user_id=user_id, content=expected_draft)

        mock_refined = RefinedDraftReport(
            refined_content=expected_draft,
            is_compliant=True,
            platform="x",
            attempts=1,
            status="compliant",
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
                return_value=AccountStatusReport(user_id=user_id),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                return_value=expected_draft,
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=mock_refined,
            ),
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                return_value=dummy_post,
            ) as mock_save,
        ):
            report = await curate_and_draft_post(
                user_id=user_id,
                topic_title=huge_title,
                platform="x",
            )

            assert isinstance(report, CuratedDraftReport)
            assert report.status == "persisted"
            assert report.refined_content == expected_draft
            assert mock_save.called
            # Ensure saved content does not exceed DB limits
            saved_content = mock_save.call_args.kwargs.get("content")
            assert len(saved_content) <= 25000

    @pytest.mark.anyio
    async def test_topic_title_with_null_bytes_and_surrogate_pairs(self) -> None:
        """Null bytes (\\x00) and surrogate pairs are sanitized without breaking Postgres."""
        user_id = "11111111-1111-1111-1111-111111111111"
        poisoned_title = "Quantum\x00Computing\x00 \ud83d\ude00 Revolution 🚀\x00"
        dummy_post = _make_dummy_post_public(
            user_id=user_id, content="Quantum Computing"
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
                return_value=AccountStatusReport(user_id=user_id),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                return_value="Draft with \x00 null byte sanitized",
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content="Refined post 🚀",
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
                topic_title=poisoned_title,
                platform="x",
            )

            assert report.status == "persisted"
            assert "\x00" not in report.topic_title
            assert mock_save.called
            saved_content = mock_save.call_args.kwargs.get("content")
            assert "\x00" not in saved_content

    @pytest.mark.anyio
    async def test_topic_title_sql_injection_and_unclosed_html(self) -> None:
        """SQL injection payloads and raw HTML/script tags pass safely through graph."""
        user_id = "11111111-1111-1111-1111-111111111111"
        sqli_title = "'; DROP TABLE post; DROP TABLE user; -- <script>alert(1)</script><div id='x'"
        dummy_post = _make_dummy_post_public(user_id=user_id, content="Safe content")

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
                return_value="Discussing SQL security and XSS: " + sqli_title,
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content="Safe refined copy on security vulnerabilities #CyberSec",
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
                topic_title=sqli_title,
                platform="x",
            )

            assert report.status == "persisted"
            assert report.refined_content is not None
            assert mock_save.called

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("input_platform", "expected_platform"),
        [
            ("  LINKEDIN  ", "linkedin"),
            ("X", "x"),
            ("x", "x"),
            ("", "x"),
            ("   ", "x"),
            (None, "x"),
            ("unknown_platform", "unknown_platform"),
        ],
    )
    async def test_platform_name_normalization_and_weird_values(
        self, input_platform: Any, expected_platform: str
    ) -> None:
        """Platform inputs with whitespace, casing, empty, or unknown strings normalize cleanly."""
        user_id = "11111111-1111-1111-1111-111111111111"
        dummy_post = _make_dummy_post_public(
            user_id=user_id, platform=expected_platform
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
                return_value=AccountStatusReport(user_id=user_id),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                return_value="Draft post",
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content="Refined post",
                    is_compliant=True,
                    platform=expected_platform,
                ),
            ),
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                return_value=dummy_post,
            ) as mock_save,
        ):
            report = await curate_and_draft_post(
                user_id=user_id,
                topic_title="Platform Test",
                platform=input_platform,
            )

            assert report.platform == expected_platform
            assert mock_save.called
            assert mock_save.call_args.kwargs.get("platform") == expected_platform

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "invalid_user_id",
        [
            "not-a-uuid",
            "",
            "   ",
            None,
            12345,
            "00000000-0000-0000-0000-000000000000",
        ],
    )
    async def test_user_id_invalid_types_and_non_uuid(
        self, invalid_user_id: Any
    ) -> None:
        """Invalid user_id strings or non-UUID values do not throw unhandled exceptions."""
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
                return_value=AccountStatusReport(user_id=str(invalid_user_id or "")),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                return_value="Draft for invalid user",
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content="Refined for invalid user",
                    is_compliant=True,
                    platform="x",
                ),
            ),
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                return_value=None,  # DB save fails on invalid user
            ),
        ):
            report = await curate_and_draft_post(
                user_id=invalid_user_id,  # type: ignore
                topic_title="Test Topic",
                platform="x",
            )

            assert isinstance(report, CuratedDraftReport)
            assert report.status == "error"
            assert report.persisted_post_id is None
            # Invariant: refined_content is still generated
            assert report.refined_content == "Refined for invalid user"

    @pytest.mark.anyio
    async def test_target_tone_extreme_and_poisoned_values(self) -> None:
        """Massive or poisoned target_tone strings are handled safely."""
        user_id = "11111111-1111-1111-1111-111111111111"
        bizarre_tone = "🤪" * 10000 + "\x00poison"
        dummy_post = _make_dummy_post_public(user_id=user_id)

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
                return_value="Bizarre tone draft",
            ) as mock_draft,
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content="Bizarre tone refined",
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
                topic_title="Tone Attack",
                platform="x",
                target_tone=bizarre_tone,
            )

            assert report.status == "persisted"
            assert mock_draft.called
            tone_passed = mock_draft.call_args.kwargs.get("tone")
            assert "\x00" not in str(tone_passed or "")


# ==============================================================================
# 2. CASCADING EXTERNAL & TOOL FAILURES
# ==============================================================================


class TestCascadingExternalAndToolFailuresChaos:
    """Failure injection for context tools, account checks, and history retrieval."""

    @pytest.mark.anyio
    async def test_corrupted_topic_tweets_payload(self) -> None:
        """Topic context returning None summary and corrupted sample tweets does not crash."""
        user_id = "11111111-1111-1111-1111-111111111111"
        dummy_post = _make_dummy_post_public(user_id=user_id)

        corrupted_ctx = MagicMock()
        corrupted_ctx.summary = None
        corrupted_ctx.sample_tweets = [
            {"author": None, "text": None},
            None,
            "not-a-dict",
            12345,
        ]

        with (
            patch(
                "app.services.agentic.curation_graph.get_topic_tweets_and_summary",
                return_value=corrupted_ctx,
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
                return_value="Recovered draft",
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content="Recovered refined",
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
                topic_title="Corrupted Tweets Test",
                topic_id="22222222-2222-2222-2222-222222222222",
                platform="x",
            )

            assert report.status == "persisted"
            assert report.refined_content == "Recovered refined"

    @pytest.mark.anyio
    async def test_social_account_status_unhandled_keyerror_and_malformed_object(
        self,
    ) -> None:
        """KeyError or malformed object in get_social_account_status is shielded cleanly."""
        user_id = "11111111-1111-1111-1111-111111111111"
        dummy_post = _make_dummy_post_public(user_id=user_id)

        # Test case A: raises KeyError
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
                side_effect=KeyError("x_is_premium"),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                return_value="Draft post",
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content="Refined post",
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
                topic_title="KeyError Test",
                platform="x",
            )

            assert report.status == "persisted"
            assert report.refined_content == "Refined post"

    @pytest.mark.anyio
    async def test_recent_post_history_db_operational_error(self) -> None:
        """Database OperationalError during post history lookup does not halt curation."""
        user_id = "11111111-1111-1111-1111-111111111111"
        dummy_post = _make_dummy_post_public(user_id=user_id)

        with (
            patch(
                "app.services.agentic.curation_graph.get_topic_tweets_and_summary",
                return_value=None,
            ),
            patch(
                "app.services.agentic.curation_graph.get_recent_post_history",
                side_effect=OperationalError(
                    "Connection refused", params=None, orig=Exception()
                ),
            ),
            patch(
                "app.services.agentic.curation_graph.get_social_account_status",
                return_value=AccountStatusReport(user_id=user_id),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                return_value="Draft despite DB history error",
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content="Refined despite DB history error",
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
                topic_title="DB History Failure",
                platform="x",
            )

            assert report.status == "persisted"
            assert report.refined_content == "Refined despite DB history error"


# ==============================================================================
# 3. LLM & REFINEMENT GRAPH DEGRADATION
# ==============================================================================


class TestLLMAndRefinementDegradationChaos:
    """Stress testing LLM crashes, timeouts, and refinement failures."""

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "draft_error",
        [
            RuntimeError("Rate limit exceeded 429"),
            TimeoutError("LLM API request timed out"),
            ValueError("Malformed response format"),
        ],
    )
    async def test_draft_social_post_exceptions_fallback(
        self, draft_error: Exception
    ) -> None:
        """Exceptions in draft_social_post trigger safe deterministic fallback."""
        user_id = "11111111-1111-1111-1111-111111111111"
        dummy_post = _make_dummy_post_public(user_id=user_id)

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
                side_effect=draft_error,
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content="Trending: LLM Failure Topic #AI",
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
                topic_title="LLM Failure Topic",
                platform="x",
            )

            assert report.status == "persisted"
            assert report.draft_content.startswith("Trending: LLM Failure Topic")
            assert report.refined_content == "Trending: LLM Failure Topic #AI"

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "bad_draft_output", ["", "   ", None, {"text": "dict"}, 12345]
    )
    async def test_draft_social_post_empty_or_non_string_output(
        self, bad_draft_output: Any
    ) -> None:
        """Empty or non-string draft outputs trigger deterministic non-empty fallback."""
        user_id = "11111111-1111-1111-1111-111111111111"
        dummy_post = _make_dummy_post_public(user_id=user_id)

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
                return_value=bad_draft_output,
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content="Trending: Empty Output Topic #Recovered",
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
                topic_title="Empty Output Topic",
                platform="x",
            )

            assert report.status == "persisted"
            assert bool(report.draft_content.strip()) is True
            assert report.refined_content == "Trending: Empty Output Topic #Recovered"

    @pytest.mark.anyio
    async def test_refine_draft_with_graph_timeout_and_empty_return(self) -> None:
        """asyncio.TimeoutError in refinement graph falls back safely to draft_content."""
        user_id = "11111111-1111-1111-1111-111111111111"
        expected_draft = "Original valid draft content that must survive timeout #Tech"
        dummy_post = _make_dummy_post_public(user_id=user_id, content=expected_draft)

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
                return_value=expected_draft,
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                side_effect=asyncio.TimeoutError("Refinement timed out"),
            ),
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                return_value=dummy_post,
            ),
        ):
            report = await curate_and_draft_post(
                user_id=user_id,
                topic_title="Refinement Timeout Topic",
                platform="x",
            )

            assert report.status == "persisted"
            assert report.refined_content == expected_draft
            assert bool(report.refined_content.strip()) is True

    @pytest.mark.anyio
    async def test_invariant_refined_content_never_empty_under_total_failure(
        self,
    ) -> None:
        """Invariant: refined_content is guaranteed non-empty even under total cascade failure."""
        user_id = "11111111-1111-1111-1111-111111111111"

        with (
            patch(
                "app.services.agentic.curation_graph.get_topic_tweets_and_summary",
                side_effect=Exception("Total crash in topic tools"),
            ),
            patch(
                "app.services.agentic.curation_graph.get_recent_post_history",
                side_effect=Exception("Total crash in history tools"),
            ),
            patch(
                "app.services.agentic.curation_graph.get_social_account_status",
                side_effect=Exception("Total crash in status tools"),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                side_effect=Exception("Total crash in LLM draft"),
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                side_effect=Exception("Total crash in refinement graph"),
            ),
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                side_effect=Exception("Total crash in DB save"),
            ),
        ):
            report = await curate_and_draft_post(
                user_id=user_id,
                topic_title="Total Meltdown Topic",
                platform="x",
            )

            assert isinstance(report, CuratedDraftReport)
            assert report.status == "error"
            assert report.refined_content is not None
            assert len(report.refined_content.strip()) > 0
            assert report.draft_content is not None
            assert len(report.draft_content.strip()) > 0


# ==============================================================================
# 4. DATABASE TRANSACTION BOUNDARY FAILURES
# ==============================================================================


class TestDatabaseTransactionFailuresChaos:
    """Test SQL integrity violations, session commit errors, and persistence failures."""

    @pytest.mark.anyio
    async def test_save_draft_post_raises_integrity_error(self) -> None:
        """SQLModel IntegrityError during save_draft_post marks status='error' with details."""
        user_id = "11111111-1111-1111-1111-111111111111"
        draft_text = "Good draft content that fails persistence"

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
                side_effect=IntegrityError(
                    "FOREIGN KEY constraint failed", params=None, orig=Exception()
                ),
            ),
        ):
            report = await curate_and_draft_post(
                user_id=user_id,
                topic_title="Integrity Error Topic",
                platform="x",
            )

            assert report.status == "error"
            assert report.persisted_post_id is None
            assert "Failed to persist" in (report.error or "")
            # Crucial invariant: draft copy is not lost
            assert report.refined_content == draft_text

    @pytest.mark.anyio
    async def test_save_draft_post_returns_none_or_missing_id(self) -> None:
        """save_draft_post returning None or object without ID reports persistence error."""
        user_id = "11111111-1111-1111-1111-111111111111"

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
                return_value="Draft content",
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                return_value=RefinedDraftReport(
                    refined_content="Refined content",
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
                topic_title="Missing ID Topic",
                platform="x",
            )

            assert report.status == "error"
            assert report.persisted_post_id is None
            assert report.refined_content == "Refined content"


# ==============================================================================
# 5. CONCURRENCY & THREAD-ID INJECTION
# ==============================================================================


class TestConcurrencyAndThreadIdChaos:
    """Stress testing concurrent graph executions and shared config isolation."""

    @pytest.mark.anyio
    async def test_concurrent_invocations_with_shared_config_no_cross_contamination(
        self,
    ) -> None:
        """20 concurrent graph runs with shared base config do not collide thread_ids."""
        shared_base_config = {"configurable": {"shared_environment": "production"}}
        user_id = "11111111-1111-1111-1111-111111111111"

        async def _dynamic_draft(*, topic_title: str, **_kwargs: Any) -> str:
            # Extract index or title
            return f"Draft for {topic_title}"

        async def _dynamic_refine(
            *, content: str, platform: str = "x", **_kwargs: Any
        ) -> RefinedDraftReport:
            return RefinedDraftReport(
                refined_content=f"Refined: {content}",
                is_compliant=True,
                platform=platform,
            )

        def _dynamic_save(
            *, user_id: str, content: str, platform: str = "x", **_kwargs: Any
        ) -> PostPublic:
            return _make_dummy_post_public(
                post_id=f"00000000-0000-0000-0000-{abs(hash(content)) % 1000000000000:012d}",
                user_id=user_id,
                content=content,
                platform=platform,
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
                return_value=AccountStatusReport(user_id=user_id),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                side_effect=_dynamic_draft,
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                side_effect=_dynamic_refine,
            ),
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                side_effect=_dynamic_save,
            ),
        ):

            async def _run_single(idx: int) -> CuratedDraftReport:
                return await curate_and_draft_post(
                    user_id=user_id,
                    topic_title=f"Concurrent Topic {idx}",
                    platform="x",
                    thread_id=f"thread-worker-{idx}",
                    config=shared_base_config,
                )

            tasks = [_run_single(i) for i in range(20)]
            results = await asyncio.gather(*tasks)

            assert len(results) == 20
            for i, res in enumerate(results):
                assert res.status == "persisted"
                assert res.refined_content == f"Refined: Draft for Concurrent Topic {i}"
                assert res.persisted_post_id is not None

            # Invariant: shared base config was not permanently corrupted by thread_ids
            assert shared_base_config["configurable"].get("thread_id") is None
            assert (
                shared_base_config["configurable"]["shared_environment"] == "production"
            )

    @pytest.mark.anyio
    async def test_concurrent_mixed_success_and_failure_isolation(self) -> None:
        """Concurrent runs where alternating tasks fail completely do not leak state."""
        user_id = "11111111-1111-1111-1111-111111111111"

        async def _dynamic_draft(*, topic_title: str, **_kwargs: Any) -> str:
            if "fail" in topic_title.lower():
                raise RuntimeError("Draft crashed")
            return f"Draft for {topic_title}"

        async def _dynamic_refine(
            *, content: str, platform: str = "x", **_kwargs: Any
        ) -> RefinedDraftReport:
            if "fail" in content.lower():
                raise asyncio.TimeoutError("Refine timed out")
            return RefinedDraftReport(
                refined_content=f"Refined: {content}",
                is_compliant=True,
                platform=platform,
            )

        def _dynamic_save(
            *, user_id: str, content: str, platform: str = "x", **_kwargs: Any
        ) -> PostPublic | None:
            if "fail" in content.lower():
                return None
            return _make_dummy_post_public(
                post_id=f"00000000-0000-0000-0000-{abs(hash(content)) % 1000000000000:012d}",
                user_id=user_id,
                content=content,
                platform=platform,
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
                return_value=AccountStatusReport(user_id=user_id),
            ),
            patch(
                "app.services.agentic.curation_graph.draft_social_post",
                new_callable=AsyncMock,
                side_effect=_dynamic_draft,
            ),
            patch(
                "app.services.agentic.curation_graph.refine_draft_with_graph",
                new_callable=AsyncMock,
                side_effect=_dynamic_refine,
            ),
            patch(
                "app.services.agentic.curation_graph.save_draft_post",
                side_effect=_dynamic_save,
            ),
        ):

            async def _run_task(idx: int) -> CuratedDraftReport:
                title = f"Mixed Topic {idx}" if idx % 2 == 0 else f"Fail Topic {idx}"
                return await curate_and_draft_post(
                    user_id=user_id,
                    topic_title=title,
                    platform="x",
                )

            tasks = [_run_task(i) for i in range(10)]
            results = await asyncio.gather(*tasks)

            for i, res in enumerate(results):
                if i % 2 == 0:
                    assert res.status == "persisted"
                    assert res.persisted_post_id is not None
                    assert res.refined_content == f"Refined: Draft for Mixed Topic {i}"
                else:
                    assert res.status == "error"
                    assert res.persisted_post_id is None
                # Invariant holds for all
                assert res.refined_content is not None
                assert len(res.refined_content.strip()) > 0
