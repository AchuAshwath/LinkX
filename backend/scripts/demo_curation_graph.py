"""Standalone Demonstration for CurationGraph (Tier 2 Domain Orchestrator).

Takes the latest real trending topic and tweets from PostgreSQL (populated by ScrapingGraph),
runs the CurationGraph (context gathering, platform-specific drafting, and DraftRefinementGraph polishing),
and saves the post to PostgreSQL with status="draft" (HITL gate).

Usage:
    cd backend && uv run python scripts/demo_curation_graph.py [user_id] [topic_id_or_title]
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

# Add backend directory to sys.path
sys.path.append(str(Path(__file__).parent.parent))

from sqlmodel import Session, select

from app.core.db import engine
from app.models import Post, TrendingTopic, TrendingTweet, User
from app.services.agentic import curate_and_draft_post


def _print_header() -> None:
    """Print demo run banner."""
    print("=" * 72)
    print("✍️  DEMO: CurationGraph Multi-Channel AI Curation & Drafting")
    print("=" * 72)
    print("Fetching latest scraped trending topic from PostgreSQL...\n")


def _get_target_topic(topic_arg: str | None) -> TrendingTopic | None:
    """Find trending topic by ID/title or fallback to latest scraped topic."""
    with Session(engine) as session:
        if topic_arg:
            try:
                import uuid

                topic_uuid = uuid.UUID(topic_arg)
                topic = session.get(TrendingTopic, topic_uuid)
                if topic:
                    return topic
            except (ValueError, TypeError):
                topic = session.exec(
                    select(TrendingTopic).where(
                        TrendingTopic.topic_title.contains(topic_arg)  # type: ignore[attr-defined]
                    )
                ).first()
                if topic:
                    return topic

        # Fallback to latest scraped topic
        return session.exec(
            select(TrendingTopic)
            .order_by(TrendingTopic.scraped_at.desc())  # type: ignore[attr-defined]
            .limit(1)
        ).first()


async def main() -> None:
    """Main execution flow for CurationGraph."""
    _print_header()

    user_id_arg = sys.argv[1] if len(sys.argv) > 1 else None
    topic_arg = sys.argv[2] if len(sys.argv) > 2 else None

    with Session(engine) as session:
        first_user = session.exec(select(User)).first()
        user_id = user_id_arg or (
            str(first_user.id) if first_user else "93c0700a-423f-42eb-8c91-0b90f300ca11"
        )

    topic = _get_target_topic(topic_arg)
    if not topic:
        print("❌ No trending topic found in database. Run scraping first!")
        return

    with Session(engine) as session:
        tweets = session.exec(
            select(TrendingTweet).where(TrendingTweet.topic_id == topic.id)
        ).all()

    print(f'📌 Selected Topic: "{topic.topic_title}"')
    print(f"   • Topic ID:       {topic.id}")
    print(f"   • Category:       {topic.category or 'N/A'}")
    print(f"   • Post Count:     {topic.post_count or 0:,}")
    print(f"   • Grok Summary:   {topic.summary or 'None'}")
    print(f"   • Tweets in DB:   {len(tweets)} sample tweets")
    print("\n⏳ Running CurationGraph (Drafting + Refinement Loop)...\n")

    start_time = time.time()
    try:
        report = await curate_and_draft_post(
            user_id=user_id,
            topic_title=topic.topic_title,
            topic_id=str(topic.id),
            platform="x",
            target_tone="engaging, punchy, insightful",
            thread_id=f"demo-curation-{int(time.time())}",
        )
        duration = round(time.time() - start_time, 2)

        print("=" * 72)
        print(f"📊 CURATIONGRAPH EXECUTION COMPLETED ({duration}s)")
        print("=" * 72)
        print(f"Status:               {report.status}")
        print(f"Platform:             {report.platform}")
        print(f"Compliant:            {report.is_compliant}")
        print(f"Refinement Attempts:  {report.refinement_attempts}")
        print(f"Persisted Post ID:    {report.persisted_post_id}")

        print("\n📝 Original AI Draft:")
        print("   " + report.draft_content.replace("\n", "\n   "))

        print("\n✨ Final Refined Copy:")
        print("   " + report.refined_content.replace("\n", "\n   "))

        if report.persisted_post_id:
            with Session(engine) as session:
                post = session.get(Post, report.persisted_post_id)
                if post:
                    print("\n💾 Verified in PostgreSQL 'post' table:")
                    print(f"   • ID:       {post.id}")
                    print(f"   • Status:   {post.status} (HITL Draft Gate)")
                    print(f"   • Method:   {post.method}")
                    print(f"   • Platform: {post.platform}")

        print("\n" + "=" * 72)
    except Exception as exc:
        print(f"\n❌ CurationGraph failed with exception: {exc}")
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
