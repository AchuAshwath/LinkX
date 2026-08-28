"""Unit and integration tests for VerificationGraph orchestrator."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import Post
from app.services.agentic.schemas import (
    VerificationGraphReport,
)
from app.services.agentic.verification_graph import (
    VerificationGraphState,
    build_verification_graph,
    fetch_unverified_posts_node,
    verify_posts_with_graph,
)
from app.services.agentic.verification_matching import (
    calculate_token_overlap,
    format_canonical_post_url,
    fuzzy_match_text,
    match_post_on_timeline,
    probe_url_reachability,
)

# ==============================================================================
# MATCHING HELPER UNIT TESTS
# ==============================================================================


def test_token_overlap_calculation() -> None:
    """Test calculate_token_overlap returns ratio and passes threshold >= 0.70."""
    passed, ratio = calculate_token_overlap(
        expected="autonomous ai agent swarms",
        actual="autonomous ai agent swarms are live",
    )
    assert passed is True
    assert ratio >= 0.70

    failed, f_ratio = calculate_token_overlap(
        expected="completely different topic about cooking",
        actual="autonomous ai agent swarms",
    )
    assert failed is False
    assert f_ratio < 0.30


def test_fuzzy_match_text_exact_and_substring() -> None:
    """Test fuzzy_match_text handles exact match and substring match."""
    is_match, conf = fuzzy_match_text(
        expected="Hello world from LinkX",
        actual="hello world from linkx",
    )
    assert is_match is True
    assert conf == 1.0

    sub_match, sub_conf = fuzzy_match_text(
        expected="Breaking News: Autonomous agent swarms launched today",
        actual="Breaking News: Autonomous agent swarms launched today with full test suite",
    )
    assert sub_match is True
    assert sub_conf >= 0.95


def test_match_post_on_timeline_id_and_fuzzy() -> None:
    """Test match_post_on_timeline matches by ID and by fuzzy content."""
    tweets = [
        {"text": "Random tweet", "status_id": "11111"},
        {"text": "LinkX AI agent launch in 2026", "status_id": "22222"},
    ]

    # Match by ID
    matched, text, tid, conf = match_post_on_timeline(
        expected_content="LinkX AI agent launch in 2026",
        expected_ext_id="22222",
        timeline_tweets=tweets,
    )
    assert matched is True
    assert tid == "22222"
    assert conf == 1.0

    # Match by fuzzy text without ID
    f_matched, f_text, f_tid, f_conf = match_post_on_timeline(
        expected_content="LinkX AI agent launch in 2026",
        expected_ext_id=None,
        timeline_tweets=tweets,
    )
    assert f_matched is True
    assert f_tid == "22222"
    assert f_conf >= 0.95


def test_format_canonical_post_url() -> None:
    """Test URL formatting for X and LinkedIn."""
    x_url = format_canonical_post_url(platform="x", ext_id="123456789")
    assert x_url == "https://x.com/i/status/123456789"

    li_url = format_canonical_post_url(
        platform="linkedin", ext_id="urn:li:share:987654"
    )
    assert li_url == "https://www.linkedin.com/feed/update/urn:li:share:987654"

    none_url = format_canonical_post_url(platform="x", ext_id=None)
    assert none_url is None


# ==============================================================================
# VERTICAL SLICE TESTS
# ==============================================================================


@pytest.mark.anyio
async def test_slice_1_x_profile_fuzzy_match() -> None:
    """Slice 1: Single post verified on live X profile via fuzzy token overlap."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    fake_post = Post(
        id=uuid.UUID(post_id),
        owner_id=uuid.UUID(user_id),
        content="Deploying autonomous agents with LangGraph in production.",
        platform="x",
        status="published",
        external_post_id="99887766",
    )

    mock_tweets = [
        {
            "text": "Deploying autonomous agents with LangGraph in production today!",
            "status_id": "99887766",
            "status_url": "https://x.com/user/status/99887766",
        }
    ]

    with (
        patch(
            "app.services.agentic.verification_graph._load_target_posts_from_db",
            return_value=[
                {
                    "id": post_id,
                    "content": fake_post.content,
                    "platform": "x",
                    "external_post_id": "99887766",
                }
            ],
        ),
        patch(
            "app.services.agentic.verification_graph._scrape_x_profile_feed",
            new_callable=AsyncMock,
            return_value=mock_tweets,
        ),
        patch(
            "app.services.agentic.verification_graph.probe_url_reachability",
            new_callable=AsyncMock,
            return_value=(True, 200, None),
        ),
    ):
        report = await verify_posts_with_graph(
            user_id=user_id,
            post_ids=[post_id],
            platform="x",
        )

        assert isinstance(report, VerificationGraphReport)
        assert report.status == "completed"
        assert post_id in report.verified_post_ids
        assert len(report.items) == 1
        assert report.items[0].is_verified is True
        assert report.items[0].live_url == "https://x.com/i/status/99887766"


@pytest.mark.anyio
async def test_slice_2_x_profile_unverified_post() -> None:
    """Slice 2: Post not found in timeline is marked unverified cleanly."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    with (
        patch(
            "app.services.agentic.verification_graph._load_target_posts_from_db",
            return_value=[
                {
                    "id": post_id,
                    "content": "Secret post that was never published",
                    "platform": "x",
                    "external_post_id": None,
                }
            ],
        ),
        patch(
            "app.services.agentic.verification_graph._scrape_x_profile_feed",
            new_callable=AsyncMock,
            return_value=[{"text": "Unrelated topic", "status_id": "111"}],
        ),
    ):
        report = await verify_posts_with_graph(
            user_id=user_id,
            post_ids=[post_id],
            platform="x",
        )

        assert post_id in report.unverified_post_ids
        assert len(report.items) == 1
        assert report.items[0].is_verified is False


@pytest.mark.anyio
async def test_slice_3_linkedin_post_verification() -> None:
    """Slice 3: LinkedIn post verification via URN presence."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    with (
        patch(
            "app.services.agentic.verification_graph._load_target_posts_from_db",
            return_value=[
                {
                    "id": post_id,
                    "content": "LinkedIn article on agentic workflows",
                    "platform": "linkedin",
                    "external_post_id": "urn:li:share:77665544",
                }
            ],
        ),
        patch(
            "app.services.agentic.verification_graph.probe_url_reachability",
            new_callable=AsyncMock,
            return_value=(True, 200, None),
        ),
    ):
        report = await verify_posts_with_graph(
            user_id=user_id,
            post_ids=[post_id],
            platform="linkedin",
        )

        assert post_id in report.verified_post_ids
        assert len(report.items) == 1
        assert report.items[0].is_verified is True
        assert (
            report.items[0].live_url
            == "https://www.linkedin.com/feed/update/urn:li:share:77665544"
        )


@pytest.mark.anyio
async def test_slice_4_dual_platform_batch_verification() -> None:
    """Slice 4: Multi-post batch verification across X and LinkedIn."""
    user_id = str(uuid.uuid4())
    x_post_id = str(uuid.uuid4())
    li_post_id = str(uuid.uuid4())

    target_posts = [
        {
            "id": x_post_id,
            "content": "X tweet content",
            "platform": "x",
            "external_post_id": "112233",
        },
        {
            "id": li_post_id,
            "content": "LinkedIn post content",
            "platform": "linkedin",
            "external_post_id": "urn:li:share:445566",
        },
    ]

    mock_tweets = [{"text": "X tweet content", "status_id": "112233"}]

    with (
        patch(
            "app.services.agentic.verification_graph._load_target_posts_from_db",
            return_value=target_posts,
        ),
        patch(
            "app.services.agentic.verification_graph._scrape_x_profile_feed",
            new_callable=AsyncMock,
            return_value=mock_tweets,
        ),
        patch(
            "app.services.agentic.verification_graph.probe_url_reachability",
            new_callable=AsyncMock,
            return_value=(True, 200, None),
        ),
    ):
        report = await verify_posts_with_graph(
            user_id=user_id,
            post_ids=[x_post_id, li_post_id],
            platform="both",
        )

        assert len(report.verified_post_ids) == 2
        assert x_post_id in report.verified_post_ids
        assert li_post_id in report.verified_post_ids


@pytest.mark.anyio
async def test_slice_5_probe_url_reachability_tombstone_handling() -> None:
    """Slice 5: Reachability probe detects tombstone text or HTTP errors."""
    with patch(
        "app.services.agentic.verification_matching.httpx.AsyncClient"
    ) as mock_client_cls:
        mock_client = AsyncMock()
        mock_client_cls.return_value.__aenter__.return_value = mock_client

        # Case 1: Healthy HTTP 200
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "<html><body>Tweet is visible!</body></html>"
        mock_client.get.return_value = mock_resp

        ok, code, err = await probe_url_reachability(url="https://x.com/status/1")
        assert ok is True
        assert code == 200
        assert err is None

        # Case 2: Tombstone phrase in body
        mock_resp.text = "<html><body>This Tweet is unavailable</body></html>"
        t_ok, t_code, t_err = await probe_url_reachability(url="https://x.com/status/2")
        assert t_ok is False
        assert t_code == 200
        assert "Tombstone detected" in str(t_err)

        # Case 3: HTTP 404
        mock_resp.status_code = 404
        e_ok, e_code, e_err = await probe_url_reachability(url="https://x.com/status/3")
        assert e_ok is False
        assert e_code == 404


@pytest.mark.anyio
async def test_slice_6_invalid_user_id_error_handling() -> None:
    """Slice 6: fetch_unverified_posts_node handles invalid user_id cleanly."""
    state: VerificationGraphState = {"user_id": "invalid-uuid", "post_ids": []}
    out = await fetch_unverified_posts_node(state)
    assert out["status"] == "error"
    assert "Invalid user_id" in str(out["error"])


@pytest.mark.anyio
async def test_slice_7_graph_compilation_and_schema_validation() -> None:
    """Slice 7: build_verification_graph compiles into runnable StateGraph."""
    graph = build_verification_graph()
    assert graph is not None
    assert hasattr(graph, "ainvoke")


@pytest.mark.anyio
async def test_slice_8_cross_posting_dual_channel_verification() -> None:
    """Slice 8: Cross-posted post on platform='both' verifies both X and LinkedIn channels."""
    user_id = str(uuid.uuid4())
    post_id = str(uuid.uuid4())

    target_posts = [
        {
            "id": post_id,
            "content": "Cross-posted post content",
            "platform": "both",
            "external_post_id": "linkedin:urn:li:share:111,x:222",
        }
    ]

    mock_tweets = [{"text": "Cross-posted post content", "status_id": "222"}]

    with (
        patch(
            "app.services.agentic.verification_graph._load_target_posts_from_db",
            return_value=target_posts,
        ),
        patch(
            "app.services.agentic.verification_graph._scrape_x_profile_feed",
            new_callable=AsyncMock,
            return_value=mock_tweets,
        ),
        patch(
            "app.services.agentic.verification_graph.probe_url_reachability",
            new_callable=AsyncMock,
            return_value=(True, 200, None),
        ),
    ):
        report = await verify_posts_with_graph(
            user_id=user_id,
            post_ids=[post_id],
            platform="both",
        )

        assert post_id in report.verified_post_ids
        assert len(report.items) == 2
        platforms = [it.platform for it in report.items]
        assert "linkedin" in platforms
        assert "x" in platforms


@pytest.mark.anyio
async def test_slice_9_empty_target_posts_error_status() -> None:
    """Slice 9: Non-existent post IDs return clean error status rather than silent pass."""
    user_id = str(uuid.uuid4())
    missing_id = str(uuid.uuid4())

    with patch(
        "app.services.agentic.verification_graph._load_target_posts_from_db",
        return_value=[],
    ):
        report = await verify_posts_with_graph(
            user_id=user_id,
            post_ids=[missing_id],
            platform="x",
        )

        assert report.status == "error"
        assert missing_id in report.unverified_post_ids
        assert "No valid target posts found" in str(report.error)
