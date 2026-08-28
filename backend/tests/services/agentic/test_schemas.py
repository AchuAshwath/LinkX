from app.services.agentic.schemas import (
    ExtractedTrendingTopic,
    ExtractedTweet,
    SelectorCandidate,
    SelectorDiagnosisReport,
    TrendingScrapeBatch,
    VisionDraftAnalysis,
)


def test_extracted_trending_topic_schema() -> None:
    topic = ExtractedTrendingTopic(
        title="Autonomous AI Swarms",
        category="Technology",
        post_count="45.2K posts",
        summary="Engineers deploying autonomous multi-agent swarms for workflow orchestration.",
    )
    assert topic.title == "Autonomous AI Swarms"
    assert topic.category == "Technology"
    assert topic.post_count == "45.2K posts"

    # Test serialization
    data = topic.model_dump()
    reconstructed = ExtractedTrendingTopic.model_validate(data)
    assert reconstructed == topic


def test_extracted_tweet_schema() -> None:
    tweet = ExtractedTweet(
        author_handle="@sama",
        text="Agents that execute workflows in browsers are the future.",
        likes=12000,
        retweets=3400,
        replies=890,
        views=250000,
    )
    assert tweet.author_handle == "@sama"
    assert tweet.likes == 12000
    assert tweet.views == 250000


def test_trending_scrape_batch_schema() -> None:
    batch = TrendingScrapeBatch(
        topics=[
            ExtractedTrendingTopic(title="Topic 1"),
            ExtractedTrendingTopic(title="Topic 2"),
        ]
    )
    assert len(batch.topics) == 2
    assert batch.topics[0].title == "Topic 1"


def test_selector_diagnosis_report_schema() -> None:
    candidate = SelectorCandidate(
        selector="div[data-testid='tweetTextarea_0']",
        selector_type="testid",
        confidence=0.95,
        reasoning="Matches X.com primary tweet composer textarea container",
    )
    report = SelectorDiagnosisReport(
        broken_element_name="tweet_textarea",
        page_state="authenticated",
        is_recoverable=True,
        candidate_selectors=[candidate],
    )
    assert report.broken_element_name == "tweet_textarea"
    assert report.is_recoverable is True
    assert len(report.candidate_selectors) == 1
    assert report.candidate_selectors[0].confidence == 0.95


def test_vision_draft_analysis_schema() -> None:
    analysis = VisionDraftAnalysis(
        detected_insight="Market chart showing 300% surge in agentic automation usage in 2026.",
        key_data_points=["300% YoY increase", "50% reduction in manual devops tasks"],
        linkedin_draft="Exciting data on AI automation growth in 2026...\n\nKey takeaways:\n• 300% YoY increase",
        x_draft="AI agent adoption just surged 300% YoY. Here is why the era of chat is ending and action is beginning:",
        suggested_tags=["#AIAgents", "#Automation", "#Engineering"],
    )
    assert "300%" in analysis.detected_insight
    assert len(analysis.key_data_points) == 2
    assert len(analysis.suggested_tags) == 3


def test_with_structured_output_binding() -> None:
    from app.services.agentic.client import get_chat_model

    model = get_chat_model()
    structured_model = model.with_structured_output(ExtractedTrendingTopic)
    assert structured_model is not None


def test_selector_candidate_string_and_invalid_confidence_coercion() -> None:
    """Test G14: non-numeric confidence fallback, string candidate coercion, and description alias."""
    # 1. Plain string coercion
    c_str = SelectorCandidate.model_validate("div.my-btn")
    assert c_str.selector == "div.my-btn"
    assert c_str.confidence == 0.85

    # 2. Non-numeric confidence string 'high' -> ValueError caught -> fallback to 0.85
    c_invalid = SelectorCandidate.model_validate(
        {"selector": "button.submit", "confidence": "high"}
    )
    assert c_invalid.confidence == 0.85

    # 3. Description field aliasing to reasoning
    c_desc = SelectorCandidate.model_validate(
        {"selector": "input#search", "description": "Search input box"}
    )
    assert c_desc.reasoning == "Search input box"


def test_curated_draft_report_schema() -> None:
    from app.services.agentic.schemas import CuratedDraftReport

    report = CuratedDraftReport(
        draft_content="AI is scaling rapidly.",
        refined_content="AI is scaling rapidly. Here is why: #AI",
        is_compliant=True,
        platform="x",
        topic_title="#AI",
        topic_summary="Discussion on AI scaling laws.",
        refinement_attempts=1,
        persisted_post_id="post-uuid-123",
        compliance_report={"is_compliant": True, "char_count": 40},
        status="persisted",
    )
    assert report.is_compliant is True
    assert report.persisted_post_id == "post-uuid-123"

    data = report.model_dump()
    reconstructed = CuratedDraftReport.model_validate(data)
    assert reconstructed == report


def test_scraped_batch_report_schema() -> None:
    from app.services.agentic.schemas import ScrapedBatchReport

    report = ScrapedBatchReport(
        scraped_topics=[{"title": "#AI", "url": "https://x.com/trends/1"}],
        topic_tweets_map={"https://x.com/trends/1": [{"text": "AI update"}]},
        topic_summaries={"https://x.com/trends/1": "Summary"},
        failed_topics=[],
        persisted_topic_count=1,
        persisted_tweet_count=1,
        page_state="ok",
        status="persisted",
    )
    assert report.persisted_topic_count == 1
    assert report.page_state == "ok"

    data = report.model_dump()
    reconstructed = ScrapedBatchReport.model_validate(data)
    assert reconstructed == report


def test_verification_graph_report_schemas() -> None:
    from app.services.agentic.schemas import (
        VerificationGraphReport,
        VerificationItemReport,
    )

    item = VerificationItemReport(
        post_id="post-uuid-1",
        platform="x",
        is_verified=True,
        external_post_id="1829384729384",
        matched_text="AI agents in 2026",
        match_confidence=0.95,
        live_url="https://x.com/user/status/1829384729384",
        status_code=200,
    )
    assert item.is_verified is True
    assert item.match_confidence == 0.95

    report = VerificationGraphReport(
        verified_post_ids=["post-uuid-1"],
        unverified_post_ids=[],
        items=[item],
        platform="x",
        reachability_status={"https://x.com/user/status/1829384729384": True},
        status="completed",
    )
    assert report.verified_post_ids == ["post-uuid-1"]
    assert len(report.items) == 1

    data = report.model_dump()
    reconstructed = VerificationGraphReport.model_validate(data)
    assert reconstructed == report


def test_posting_graph_report_schema() -> None:
    from app.services.agentic.schemas import PostingGraphReport

    report = PostingGraphReport(
        post_id="post-uuid-2",
        platform="both",
        content="Published across X and LinkedIn",
        x_result={"success": True, "post_id": "12345"},
        linkedin_result={"success": True, "post_id": "urn:li:share:67890"},
        published_urls=[
            "https://x.com/user/status/12345",
            "https://www.linkedin.com/feed/update/urn:li:share:67890",
        ],
        is_verified=True,
        verification_report={"status": "completed"},
        status="published",
    )
    assert report.is_verified is True
    assert report.platform == "both"
    assert len(report.published_urls) == 2

    data = report.model_dump()
    reconstructed = PostingGraphReport.model_validate(data)
    assert reconstructed == report


def test_trend_to_draft_report_schema() -> None:
    """Validate TrendToDraftReport model defaults, fields, and roundtrip serialization."""
    from app.services.agentic.schemas import TrendToDraftReport

    report = TrendToDraftReport(
        scraped_topics=[{"title": "Trending Tech", "id": "t1"}],
        persisted_post_ids=["pid-123", "pid-456"],
        platform="both",
        status="completed",
    )
    assert report.status == "completed"
    assert report.platform == "both"
    assert len(report.scraped_topics) == 1
    assert len(report.persisted_post_ids) == 2

    data = report.model_dump()
    reconstructed = TrendToDraftReport.model_validate(data)
    assert reconstructed == report


def test_publish_and_verify_report_schema() -> None:
    """Validate PublishAndVerifyReport model defaults, fields, and roundtrip serialization."""
    from app.services.agentic.schemas import PublishAndVerifyReport

    report = PublishAndVerifyReport(
        post_id="post-abc-123",
        platform="both",
        is_published=True,
        is_verified=True,
        published_urls=["https://x.com/i/status/123"],
        status="completed",
    )
    assert report.is_published is True
    assert report.is_verified is True
    assert report.post_id == "post-abc-123"

    data = report.model_dump()
    reconstructed = PublishAndVerifyReport.model_validate(data)
    assert reconstructed == report
