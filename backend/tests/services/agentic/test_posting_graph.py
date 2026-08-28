"""Unit and integration tests for PostingGraph multi-channel orchestrator."""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.models import Post
from app.services.agentic.posting_graph import (
    build_posting_graph,
    publish_post_with_graph,
)
from app.services.agentic.schemas import (
    AccountStatusReport,
    PostingGraphReport,
    VerificationGraphReport,
    VerificationItemReport,
)


def _make_fake_post(
    *,
    post_id: str,
    user_id: str,
    platform: str = "x",
    **kwargs: Any,
) -> Post:
    """Helper to instantiate mock Post models cleanly."""
    return Post(
        id=uuid.UUID(post_id),
        owner_id=uuid.UUID(user_id),
        platform=platform,
        content=kwargs.get("content", f"Post content for {platform}"),
        status=kwargs.get("status", "draft"),
        external_post_id=kwargs.get("external_post_id"),
        image_url=kwargs.get("image_url"),
    )


# ==============================================================================
# VERTICAL SLICE TESTS
# ==============================================================================


@pytest.mark.anyio
@pytest.mark.parametrize(
    "case",
    [
        {
            "platform": "x",
            "dispatch_path": "app.services.agentic.posting_nodes.dispatch_x_post",
            "dispatch_ret": (True, "1829384729384", None),
            "expected_url": "https://x.com/i/status/1829384729384",
            "acc_kwargs": {"x_connected": True, "linkedin_connected": False},
        },
        {
            "platform": "linkedin",
            "dispatch_path": "app.services.agentic.posting_nodes.dispatch_linkedin_post",
            "dispatch_ret": (True, "urn:li:share:998877", None),
            "expected_url": "https://www.linkedin.com/feed/update/urn:li:share:998877",
            "acc_kwargs": {"x_connected": False, "linkedin_connected": True},
        },
    ],
)
async def test_slices_single_platform_publishing_happy_paths(
    case: dict[str, Any],
) -> None:
    """Slices 1 & 2: Happy path single-channel publishing with embedded verification."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())
    platform = case["platform"]
    expected_url = case["expected_url"]

    fake_post = _make_fake_post(
        post_id=post_id,
        user_id=user_id,
        content=f"Post content for {platform}",
        platform=platform,
    )

    mock_verify_report = VerificationGraphReport(
        verified_post_ids=[post_id],
        unverified_post_ids=[],
        items=[
            VerificationItemReport(
                post_id=post_id,
                platform=platform,
                is_verified=True,
                live_url=expected_url,
            )
        ],
        platform=platform,
        status="completed",
    )

    with (
        patch("app.crud.get_post", return_value=fake_post),
        patch(
            "app.services.agentic.posting_preflight.get_social_account_status",
            return_value=AccountStatusReport(user_id=user_id, **case["acc_kwargs"]),
        ),
        patch(
            case["dispatch_path"],
            new_callable=AsyncMock,
            return_value=case["dispatch_ret"],
        ),
        patch(
            "app.services.agentic.posting_nodes.verify_posts_with_graph",
            new_callable=AsyncMock,
            return_value=mock_verify_report,
        ),
        patch("app.services.agentic.posting_dispatch._mark_as_published"),
    ):
        report = await publish_post_with_graph(
            user_id=user_id,
            post_id=post_id,
            platform=platform,
        )

        assert isinstance(report, PostingGraphReport)
        assert report.status == "published"
        assert report.is_verified is True
        assert expected_url in report.published_urls


@pytest.mark.anyio
@pytest.mark.parametrize(
    "case",
    [
        {
            "dispatch_ret": (True, "linkedin:urn:li:share:123,x:456", None),
            "mock_verify_ids": ["dual-post-id"],
            "expected_status": "published",
            "expected_err": None,
            "expected_urls": [
                "https://x.com/i/status/456",
                "https://www.linkedin.com/feed/update/urn:li:share:123",
            ],
        },
        {
            "dispatch_ret": (
                False,
                "linkedin:urn:li:share:123",
                "LinkedIn published, but X failed",
            ),
            "mock_verify_ids": [],
            "expected_status": "partial_failure",
            "expected_err": "LinkedIn published, but X failed",
            "expected_urls": [],
        },
    ],
)
async def test_slices_dual_platform_cross_posting(
    case: dict[str, Any],
) -> None:
    """Slices 3 & 4: Dual-platform cross posting (success and partial failure)."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    fake_post = _make_fake_post(
        post_id=post_id,
        user_id=user_id,
        content="Cross-posted content to X and LinkedIn.",
        platform="both",
    )

    with (
        patch("app.crud.get_post", return_value=fake_post),
        patch(
            "app.services.agentic.posting_preflight.get_social_account_status",
            return_value=AccountStatusReport(
                user_id=user_id, x_connected=True, linkedin_connected=True
            ),
        ),
        patch(
            "app.services.agentic.posting_nodes.dispatch_dual_post",
            new_callable=AsyncMock,
            return_value=case["dispatch_ret"],
        ),
        patch(
            "app.services.agentic.posting_nodes.verify_posts_with_graph",
            new_callable=AsyncMock,
            return_value=VerificationGraphReport(
                verified_post_ids=case["mock_verify_ids"],
                status="completed" if case["mock_verify_ids"] else "partial",
            ),
        ),
        patch("app.services.agentic.posting_dispatch._mark_as_published"),
    ):
        report = await publish_post_with_graph(
            user_id=user_id,
            post_id=post_id,
            platform="both",
        )

        assert report.status == case["expected_status"]
        if case["expected_err"]:
            assert case["expected_err"] in str(report.error)
        if case["expected_urls"]:
            assert len(report.published_urls) == len(case["expected_urls"])
            for u in case["expected_urls"]:
                assert u in report.published_urls


@pytest.mark.anyio
async def test_slice_5_preflight_failure_non_existent_post() -> None:
    """Slice 5: Preflight failure on non-existent post -> clean abort."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    with patch("app.crud.get_post", return_value=None):
        report = await publish_post_with_graph(
            user_id=user_id,
            post_id=post_id,
            platform="x",
        )

        assert report.status == "preflight_failed"
        assert "Post not found" in str(report.error)


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("acc_kwargs", "img_url", "expected_err_snippet"),
    [
        ({"x_connected": False, "linkedin_connected": False}, None, "not connected"),
        (
            {"x_connected": True, "linkedin_connected": False},
            "/non/existent/image.png",
            "image file not found",
        ),
    ],
)
async def test_slices_preflight_failures(
    acc_kwargs: dict[str, bool],
    img_url: str | None,
    expected_err_snippet: str,
) -> None:
    """Slices 6 & 7: Preflight failure on disconnected account or missing image file."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    fake_post = _make_fake_post(
        post_id=post_id,
        user_id=user_id,
        content="Preflight failure test",
        platform="x",
        image_url=img_url,
    )

    with (
        patch("app.crud.get_post", return_value=fake_post),
        patch(
            "app.services.agentic.posting_preflight.get_social_account_status",
            return_value=AccountStatusReport(user_id=user_id, **acc_kwargs),
        ),
    ):
        report = await publish_post_with_graph(
            user_id=user_id,
            post_id=post_id,
            platform="x",
        )

        assert report.status == "preflight_failed"
        assert expected_err_snippet in str(report.error)


@pytest.mark.anyio
async def test_slice_8_embedded_verification_failure_shielding() -> None:
    """Slice 8: Post remains published in DB even if embedded verification throws."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    fake_post = _make_fake_post(
        post_id=post_id,
        user_id=user_id,
        content="Post where verification times out",
        platform="x",
    )

    with (
        patch("app.crud.get_post", return_value=fake_post),
        patch(
            "app.services.agentic.posting_preflight.get_social_account_status",
            return_value=AccountStatusReport(
                user_id=user_id, x_connected=True, linkedin_connected=False
            ),
        ),
        patch(
            "app.services.agentic.posting_nodes.dispatch_x_post",
            new_callable=AsyncMock,
            return_value=(True, "987654321", None),
        ),
        patch(
            "app.services.agentic.posting_nodes.verify_posts_with_graph",
            side_effect=RuntimeError("Browser crashed during verification"),
        ),
        patch("app.services.agentic.posting_dispatch._mark_as_published"),
    ):
        report = await publish_post_with_graph(
            user_id=user_id,
            post_id=post_id,
            platform="x",
        )

        # Still marked published since dispatch succeeded
        assert report.status == "published"
        assert report.is_verified is False


@pytest.mark.anyio
async def test_slice_9_graph_compilation_and_schema_validation() -> None:
    """Slice 9: build_posting_graph compiles into runnable StateGraph."""
    graph = build_posting_graph()
    assert graph is not None
    assert hasattr(graph, "ainvoke")


@pytest.mark.anyio
async def test_slice_10_idempotent_publish_on_already_published_post() -> None:
    """Slice 10: Calling publish_post_with_graph on an already published post is idempotent."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    fake_post = _make_fake_post(
        post_id=post_id,
        user_id=user_id,
        content="Already published content",
        platform="x",
        status="published",
        external_post_id="1829384729384",
    )

    with (
        patch("app.crud.get_post", return_value=fake_post),
        patch(
            "app.services.agentic.posting_nodes.verify_posts_with_graph",
            new_callable=AsyncMock,
            return_value=VerificationGraphReport(
                verified_post_ids=[post_id], status="completed"
            ),
        ),
    ):
        report = await publish_post_with_graph(
            user_id=user_id,
            post_id=post_id,
            platform="x",
        )

        assert report.status == "published"
        assert report.is_verified is True
        assert "https://x.com/i/status/1829384729384" in report.published_urls


@pytest.mark.anyio
async def test_slice_11_cross_posting_separate_channel_results() -> None:
    """Slice 11: Cross-posting correctly decomposes results for LinkedIn and X individually."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    fake_post = _make_fake_post(
        post_id=post_id,
        user_id=user_id,
        content="Cross-posting content",
        platform="both",
    )

    with (
        patch("app.crud.get_post", return_value=fake_post),
        patch(
            "app.services.agentic.posting_preflight.get_social_account_status",
            return_value=AccountStatusReport(
                user_id=user_id, x_connected=True, linkedin_connected=True
            ),
        ),
        patch(
            "app.services.agentic.posting_nodes.dispatch_dual_post",
            new_callable=AsyncMock,
            return_value=(
                False,
                "linkedin:urn:li:share:999",
                "LinkedIn published, but X failed: Rate limited",
            ),
        ),
        patch(
            "app.services.agentic.posting_nodes.verify_posts_with_graph",
            new_callable=AsyncMock,
            return_value=VerificationGraphReport(
                verified_post_ids=[], status="partial"
            ),
        ),
        patch("app.services.agentic.posting_dispatch._mark_as_published"),
    ):
        report = await publish_post_with_graph(
            user_id=user_id,
            post_id=post_id,
            platform="both",
        )

        assert report.status == "partial_failure"
        assert report.linkedin_result is not None
        assert report.linkedin_result["success"] is True
        assert report.linkedin_result["post_id"] == "urn:li:share:999"
        assert report.x_result is not None
        assert report.x_result["success"] is False
