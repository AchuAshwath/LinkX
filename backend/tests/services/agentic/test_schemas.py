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
