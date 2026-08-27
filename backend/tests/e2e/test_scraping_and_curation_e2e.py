"""End-to-End Integration Tests for ScrapingGraph and CurationGraph Pipeline.

Validates the full lifecycle:
1. ScrapingGraph scrapes trending topics & tweets and persists to PostgreSQL.
2. Direct PostgreSQL verification of saved topics and tweets.
3. CurationGraph picks up the topic from PostgreSQL, drafts content,
   refines it through DraftRefinementGraph, and persists a draft post.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import Session, select

from app.models import Post, TrendingTopic, TrendingTweet, User
from app.services.agentic.curation_graph import curate_and_draft_post
from app.services.agentic.schemas import RefinedDraftReport
from app.services.agentic.scraping_graph import scrape_trends_with_graph


@pytest.fixture
def test_user(db: Session) -> User:
    """Create a persistent test user for E2E testing."""
    unique_email = f"e2e_pipeline_{uuid.uuid4().hex[:8]}@example.com"
    user = User(
        id=uuid.uuid4(),
        email=unique_email,
        hashed_password="hashed_test_password",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _build_mock_topic_and_tweets(
    *, user_id: uuid.UUID
) -> tuple[TrendingTopic, list[TrendingTweet]]:
    """Build mock TrendingTopic and attached tweets for scraping mock."""
    mock_topic = TrendingTopic(
        id=uuid.uuid4(),
        user_id=user_id,
        topic_url="https://x.com/search?q=Autonomous%20AI%20Agents",
        topic_title="Autonomous AI Agents",
        category="Technology",
        post_count=45000,
    )
    mock_tweets = [
        TrendingTweet(
            id=uuid.uuid4(),
            topic_id=mock_topic.id,
            author_handle="@tech_insider",
            text="Autonomous AI agents with cognitive self-healing and stealth browsing are transforming automation.",
            likes=1200,
            retweets=350,
            replies=42,
            views=25000,
        ),
        TrendingTweet(
            id=uuid.uuid4(),
            topic_id=mock_topic.id,
            author_handle="@ai_researcher",
            text="Deterministic stealth evasion combined with LangGraph state machines sets a new bar for reliability.",
            likes=850,
            retweets=180,
            replies=21,
            views=15000,
        ),
    ]
    return mock_topic, mock_tweets


def _verify_scraping_db_persistence(
    *, db: Session, user_id: uuid.UUID
) -> TrendingTopic:
    """Verify topic and tweet records are correctly stored in PostgreSQL."""
    persisted_topic = db.exec(
        select(TrendingTopic).where(TrendingTopic.topic_title == "Autonomous AI Agents")
    ).first()
    assert persisted_topic is not None
    assert persisted_topic.user_id == user_id

    persisted_tweets = db.exec(
        select(TrendingTweet).where(TrendingTweet.topic_id == persisted_topic.id)
    ).all()
    assert len(persisted_tweets) == 2
    assert persisted_tweets[0].author_handle in ("@tech_insider", "@ai_researcher")
    return persisted_topic


def _verify_curation_db_persistence(
    *,
    db: Session,
    post_id_str: str,
    user_id: uuid.UUID,
    expected_content: str,
) -> None:
    """Verify curated Post entity is correctly stored in PostgreSQL."""
    persisted_post = db.exec(
        select(Post).where(Post.id == uuid.UUID(post_id_str))
    ).first()
    assert persisted_post is not None
    assert persisted_post.owner_id == user_id
    assert persisted_post.status == "draft"
    assert persisted_post.platform == "x"
    assert persisted_post.content == expected_content


@pytest.mark.anyio
async def test_e2e_scraping_to_curation_pipeline(
    db: Session,
    test_user: User,
) -> None:
    """Validate full end-to-end pipeline from ScrapingGraph to CurationGraph."""
    user_id_str = str(test_user.id)
    mock_sidebar_topic, mock_raw_tweets = _build_mock_topic_and_tweets(
        user_id=test_user.id
    )

    mock_page = AsyncMock()
    mock_page.url = "https://x.com/home"
    mock_page.goto = AsyncMock()
    mock_page.inner_text = AsyncMock(return_value="Autonomous AI Agents Timeline")

    mock_context = AsyncMock()
    mock_context.pages = [mock_page]

    # 1. Run ScrapingGraph with patched browser operations
    with (
        patch(
            "app.services.agentic.scraping_graph.BrowserManager.session_exists",
            return_value=True,
        ),
        patch(
            "app.services.agentic.scraping_graph.BrowserManager.get_context"
        ) as mock_get_context,
        patch(
            "app.services.agentic.scraping_graph.detect_page_state",
            new=AsyncMock(return_value="ok"),
        ),
        patch(
            "app.services.agentic.scraping_graph.extract_trending_sidebar",
            new=AsyncMock(return_value=[mock_sidebar_topic]),
        ),
        patch(
            "app.services.agentic.scraping_graph.extract_grok_summary",
            new=AsyncMock(
                return_value="Autonomous AI agents are trending as new architectures combine deterministic evasion with LLM self-healing."
            ),
        ),
        patch(
            "app.services.agentic.scraping_graph.extract_topic_tweets",
            new=AsyncMock(return_value=mock_raw_tweets),
        ),
        patch(
            "app.services.agentic.scraping_graph.human_navigation",
            new=AsyncMock(),
        ),
        patch(
            "app.services.agentic.scraping_graph.random_delay",
            new=AsyncMock(),
        ),
    ):
        mock_ctx_mgr = AsyncMock()
        mock_ctx_mgr.__aenter__.return_value = mock_context
        mock_ctx_mgr.__aexit__.return_value = None
        mock_get_context.return_value = mock_ctx_mgr

        scraping_report = await scrape_trends_with_graph(
            user_id=user_id_str,
            max_topics=1,
            headless=True,
            session=db,
        )

    assert scraping_report.status == "persisted"
    assert scraping_report.persisted_topic_count >= 1
    assert scraping_report.persisted_tweet_count >= 2

    # 2. Verify PostgreSQL Database State for Topics & Tweets
    persisted_topic = _verify_scraping_db_persistence(db=db, user_id=test_user.id)

    # 3. Run CurationGraph on the Persisted Topic
    mock_refinement_report = RefinedDraftReport(
        refined_content="Autonomous AI agents with deterministic stealth & cognitive self-healing are redefining automation. #AI #Tech",
        is_compliant=True,
        attempts=1,
        platform="x",
        compliance_report={"char_count": 105, "max_chars": 280, "is_valid": True},
        status="compliant",
    )

    with (
        patch(
            "app.services.agentic.curation_graph.draft_social_post",
            new=AsyncMock(
                return_value="Autonomous AI agents with deterministic stealth & cognitive self-healing are redefining automation."
            ),
        ),
        patch(
            "app.services.agentic.curation_graph.refine_draft_with_graph",
            new=AsyncMock(return_value=mock_refinement_report),
        ),
    ):
        curation_report = await curate_and_draft_post(
            user_id=user_id_str,
            topic_title=persisted_topic.topic_title,
            topic_id=str(persisted_topic.id),
            platform="x",
            target_tone="engaging",
            session=db,
        )

    assert curation_report.status == "persisted"
    assert curation_report.is_compliant is True
    assert curation_report.persisted_post_id is not None
    assert "Autonomous AI agents" in curation_report.refined_content

    # 4. Verify Final Post Persisted in PostgreSQL with status="draft"
    _verify_curation_db_persistence(
        db=db,
        post_id_str=curation_report.persisted_post_id,
        user_id=test_user.id,
        expected_content=curation_report.refined_content,
    )
