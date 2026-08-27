"""Chaos and adversarial stress test suite for CurationGraph (Tier 2 Domain Subgraph) - Issue #87."""

from __future__ import annotations

import asyncio
import uuid
from contextlib import contextmanager
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
    post_id: str = "33333333-3333-3333-3333-333333333333",
    user_id: str = "11111111-1111-1111-1111-111111111111",
    content: str = "Test content",
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
def patch_chaos_curation(
    *,
    topic_ctx: Any = None,
    history: Any = None,
    account_status: Any = None,
    draft_result: Any = "Valid draft #AI",
    refine_result: Any = None,
    save_result: Any = None,
    draft_side_effect: Any = None,
    refine_side_effect: Any = None,
    save_side_effect: Any = None,
):
    """Unified mock context manager for CurationGraph chaos testing."""
    default_refine = RefinedDraftReport(
        refined_content=draft_result
        if isinstance(draft_result, str) and draft_result.strip()
        else "Refined draft",
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
            "topic": p_topic,
            "history": p_history,
            "status": p_status,
            "draft": p_draft,
            "refine": p_refine,
            "save": p_save,
        }


class TestCurationGraphChaos:
    """Chaos and adversarial testing suite for CurationGraph."""

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "poisoned_title",
        [
            "A" * 100_000,
            "AI\x00Topic\x00Injected\x00NullBytes",
            "🚀🔥💡 High Tech AI Agents 🤖⚡✨",
            "'; DROP TABLE post; DROP TABLE user; --",
            "<script>alert(document.cookie)</script><h1>Exploit</h1>",
            "",
            "   \t\n   ",
        ],
    )
    async def test_adversarial_topic_titles(self, poisoned_title: str) -> None:
        with patch_chaos_curation():
            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title=poisoned_title,
            )
            assert isinstance(report, CuratedDraftReport)
            assert report.status in ("persisted", "error")
            assert "\x00" not in report.topic_title
            assert len(report.topic_title) <= 5000
            assert report.refined_content != ""

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("platform_input", "expected_platform"),
        [
            ("  LINKEDIN  ", "linkedin"),
            ("X", "x"),
            ("x", "x"),
            ("", "x"),
            ("   ", "x"),
            (None, "x"),
            ("mastodon", "mastodon"),
        ],
    )
    async def test_platform_name_sanitization(
        self, platform_input: Any, expected_platform: str
    ) -> None:
        with patch_chaos_curation() as p:
            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title="Platform Test",
                platform=platform_input,
            )
            assert report.platform == expected_platform
            assert p["draft"].call_args.kwargs["platform"] == expected_platform

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "invalid_user_id",
        [
            "",
            "not-a-uuid-string",
            "   ",
            "'; DROP TABLE user; --",
            "99999999-9999-9999-9999-999999999999",
        ],
    )
    async def test_invalid_user_id_handling(self, invalid_user_id: str) -> None:
        with patch_chaos_curation():
            report = await curate_and_draft_post(
                user_id=invalid_user_id,
                topic_title="User ID Resilience",
            )
            assert isinstance(report, CuratedDraftReport)
            assert report.refined_content != ""

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "poisoned_tone",
        ["T" * 10_000, "Injected\x00Tone\x00Value", "", "   ", None],
    )
    async def test_target_tone_sanitization(self, poisoned_tone: Any) -> None:
        with patch_chaos_curation() as p:
            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title="Tone Test",
                target_tone=poisoned_tone,
            )
            assert isinstance(report, CuratedDraftReport)
            cleaned_tone = p["draft"].call_args.kwargs["tone"]
            if cleaned_tone is not None:
                assert "\x00" not in cleaned_tone
                assert len(cleaned_tone) <= 500

    @pytest.mark.anyio
    async def test_corrupted_external_tool_payloads(self) -> None:
        mock_ctx = MagicMock()
        mock_ctx.summary = None
        mock_ctx.sample_tweets = [
            {"author": None, "text": None},
            None,
            "invalid-str-tweet",
        ]

        with patch_chaos_curation(topic_ctx=mock_ctx) as p:
            p["status"].side_effect = KeyError("missing account fields")
            p["history"].side_effect = OperationalError("DB timeout", {}, None)

            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title="External Cascade",
                topic_id="topic-1",
            )
            assert isinstance(report, CuratedDraftReport)
            assert report.status == "persisted"
            assert report.refined_content != ""

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("draft_return", "expected_non_empty"),
        [
            ("", True),
            ("   \n\t  ", True),
            (None, True),
            (12345, True),
            ({"dict": "output"}, True),
        ],
    )
    async def test_draft_social_post_degradation_modes(
        self, draft_return: Any, expected_non_empty: bool
    ) -> None:
        with patch_chaos_curation(draft_result=draft_return):
            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title="Degradation Test",
            )
            assert (report.refined_content != "") is expected_non_empty
            assert report.status in ("persisted", "error")

    @pytest.mark.anyio
    async def test_refinement_timeout_and_empty_return_shielding(self) -> None:
        empty_refine = RefinedDraftReport(
            refined_content="", is_compliant=False, status="error"
        )
        with patch_chaos_curation(
            draft_result="Original draft preserved",
            refine_result=empty_refine,
        ):
            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title="Refine Timeout",
            )
            assert report.refined_content == "Original draft preserved"

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "db_exception",
        [
            IntegrityError("violates foreign key constraint", {}, None),
            OperationalError("could not connect to server", {}, None),
        ],
    )
    async def test_db_persistence_failures_preserve_generated_content(
        self, db_exception: Exception
    ) -> None:
        with patch_chaos_curation(
            draft_result="Draft copy that must not be lost",
            save_side_effect=db_exception,
        ):
            report = await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title="DB Failure",
            )
            assert report.status == "error"
            assert report.persisted_post_id is None
            assert report.refined_content == "Draft copy that must not be lost"
            assert report.error is not None

    @pytest.mark.anyio
    async def test_concurrent_invocations_with_shared_config_no_leakage(self) -> None:
        shared_config = {"configurable": {"global_key": "base_value"}}

        async def _run_worker(idx: int) -> CuratedDraftReport:
            thread_id = f"thread-unique-{idx}"
            return await curate_and_draft_post(
                user_id="11111111-1111-1111-1111-111111111111",
                topic_title=f"Concurrent Topic {idx}",
                thread_id=thread_id,
                config=shared_config,
            )

        with patch_chaos_curation():
            tasks = [_run_worker(i) for i in range(20)]
            results = await asyncio.gather(*tasks)

            assert len(results) == 20
            assert "thread_id" not in shared_config["configurable"]
            for idx, r in enumerate(results):
                assert f"Concurrent Topic {idx}" in r.topic_title
                assert r.status == "persisted"
