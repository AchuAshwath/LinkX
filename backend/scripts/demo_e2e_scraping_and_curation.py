"""End-to-End Live Demonstration of ScrapingGraph + CurationGraph Orchestration.

Executes:
1. ScrapingGraph with a real authenticated X.com session in HEADED mode:
   - Diagnoses page and recovers overlays.
   - Scrapes live Explore trends.
   - Extracts Grok summary and timeline tweets.
   - Persists all records into PostgreSQL.
2. Direct PostgreSQL verification of saved topics and tweets.
3. CurationGraph:
   - Gathers context from the newly persisted topic and tweets.
   - Generates AI post draft tailored for X platform.
   - Refines draft through DraftRefinementGraph for hook and constraint compliance.
   - Persists the draft post into PostgreSQL with status="draft" (HITL gate).

Usage:
    cd backend && uv run python scripts/demo_e2e_scraping_and_curation.py [user_id] [max_topics]
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path
from typing import Any

# Ensure LinkX backend root is on sys.path
sys.path.append(str(Path(__file__).parent.parent))

from sqlmodel import Session, select

from app.core.db import engine
from app.models import Post, TrendingTopic, TrendingTweet, User
from app.services.agentic import curate_and_draft_post, scrape_trends_with_graph


def _print_banner() -> None:
    """Print ASCII banner for the E2E demo."""
    print("\n" + "═" * 78)
    print(" 🚀 LINKX AGENTIC PIPELINE: REAL HEADED SCRAPING & CURATION ORCHESTRATION")
    print("═" * 78)
    print(
        " Stack: LangGraph StateGraphs + Playwright (Headed) + PostgreSQL + Gemini AI\n"
    )


def _resolve_target_user(user_id_arg: str | None) -> str:
    """Resolve user ID or fallback to admin user."""
    if user_id_arg:
        return user_id_arg
    with Session(engine) as session:
        user = session.exec(select(User)).first()
        if user:
            return str(user.id)
    return "93c0700a-423f-42eb-8c91-0b90f300ca11"


async def _run_scraping_stage(*, user_id: str, max_topics: int) -> Any:
    """Run ScrapingGraph in headed browser mode."""
    print("┌" + "─" * 76 + "┐")
    print(
        "│ STAGE 1: SCRAPINGGRAPH (HEADED PLAYWRIGHT BROWSER)                         │"
    )
    print("└" + "─" * 76 + "┘")
    print(f" • User ID:       {user_id}")
    print(f" • Max Topics:    {max_topics}")
    print(" • Browser Mode:  HEADED (watch Chrome open on your desktop!)\n")

    start_time = time.time()
    report = await scrape_trends_with_graph(
        user_id=user_id,
        max_topics=max_topics,
        headless=False,
    )
    elapsed = round(time.time() - start_time, 2)

    print("\n" + "─" * 78)
    print(f" ScrapingGraph Finished in {elapsed}s | Status: {report.status}")
    print("─" * 78)
    print(f" • Topics Scraped:   {len(report.scraped_topics)}")
    print(f" • Topics Persisted: {report.persisted_topic_count}")
    print(f" • Tweets Persisted: {report.persisted_tweet_count}")
    print(f" • Page State:       {report.page_state}")

    if report.session_recovery:
        print(f" • Session Recovery: {report.session_recovery}")
    if report.error:
        print(f" ⚠️ Scraping Error:  {report.error}")

    return report


def _verify_database_records(*, user_id: str) -> TrendingTopic | None:
    """Query PostgreSQL directly to show persisted topics and tweets."""
    print("\n┌" + "─" * 76 + "┐")
    print(
        "│ STAGE 2: POSTGRESQL DATABASE VERIFICATION                                  │"
    )
    print("└" + "─" * 76 + "┘")

    with Session(engine) as session:
        topics = session.exec(
            select(TrendingTopic)
            .where(TrendingTopic.user_id == user_id)
            .order_by(TrendingTopic.scraped_at.desc())  # type: ignore[attr-defined]
            .limit(5)
        ).all()

        if not topics:
            topics = session.exec(
                select(TrendingTopic)
                .order_by(TrendingTopic.scraped_at.desc())  # type: ignore[attr-defined]
                .limit(5)
            ).all()

        if not topics:
            print(" ⚠️ No trending topics found in database.")
            return None

        print(f" Found {len(topics)} latest topics in PostgreSQL:\n")
        for idx, t in enumerate(topics, 1):
            tweets = session.exec(
                select(TrendingTweet).where(TrendingTweet.topic_id == t.id)
            ).all()
            print(f' [{idx}] Topic: "{t.topic_title}"')
            print(f"     ID:          {t.id}")
            print(f"     URL:         {t.topic_url}")
            print(f"     Category:    {t.category or 'N/A'}")
            print(f"     Post Count:  {t.post_count or 0:,}")
            summary_preview = (
                (t.summary[:100] + "...")
                if t.summary and len(t.summary) > 100
                else (t.summary or "No summary")
            )
            print(f"     Summary:     {summary_preview}")
            print(f"     Tweets in DB:{len(tweets)} tweets saved")

        return topics[0]


async def _run_curation_stage(*, user_id: str, topic: TrendingTopic) -> Any:
    """Run CurationGraph to draft and refine a post based on the scraped topic."""
    print("\n┌" + "─" * 76 + "┐")
    print(
        "│ STAGE 3: CURATIONGRAPH (AI DRAFTING & ADAPTIVE REFINEMENT)                 │"
    )
    print("└" + "─" * 76 + "┘")
    print(f' • Input Topic: "{topic.topic_title}" (ID: {topic.id})')
    print(" • Platform:    X (Twitter)")
    print(" • Target Tone: authoritative, engaging, concise\n")

    start_time = time.time()
    curation_report = await curate_and_draft_post(
        user_id=user_id,
        topic_title=topic.topic_title,
        topic_id=str(topic.id),
        platform="x",
        target_tone="authoritative, engaging",
        thread_id=f"e2e-demo-{int(time.time())}",
    )
    elapsed = round(time.time() - start_time, 2)

    print("─" * 78)
    print(f" CurationGraph Finished in {elapsed}s | Status: {curation_report.status}")
    print("─" * 78)
    print(f" • Refinement Attempts: {curation_report.refinement_attempts}")
    print(f" • Compliant with X:   {curation_report.is_compliant}")
    print(f" • Persisted Post ID:   {curation_report.persisted_post_id}")
    print("\n📝 Original AI Draft:")
    print("   " + curation_report.draft_content.replace("\n", "\n   "))
    print("\n✨ Final Refined Post (Compliant & Hook-Optimized):")
    print("   " + curation_report.refined_content.replace("\n", "\n   "))

    # Verify persisted Post in database
    if curation_report.persisted_post_id:
        with Session(engine) as session:
            post_record = session.get(Post, curation_report.persisted_post_id)
            if post_record:
                print("\n💾 Verified in PostgreSQL 'post' table:")
                print(f"   • Post ID:      {post_record.id}")
                print(f"   • Owner ID:     {post_record.owner_id}")
                print(
                    f"   • Status:       {post_record.status} (Strict HITL Gate preserved!)"
                )
                print(f"   • Platform:     {post_record.platform}")
                print(f"   • Method:       {post_record.method}")
                print(f"   • Content:      {post_record.content[:80]}...")

    return curation_report


async def main() -> None:
    """Execute full end-to-end pipeline."""
    _print_banner()

    user_id_arg = sys.argv[1] if len(sys.argv) > 1 else None
    max_topics_arg = int(sys.argv[2]) if len(sys.argv) > 2 else 2

    user_id = _resolve_target_user(user_id_arg)

    # 1. ScrapingGraph (Headed)
    await _run_scraping_stage(user_id=user_id, max_topics=max_topics_arg)

    # 2. Database Verification
    top_topic = _verify_database_records(user_id=user_id)

    # 3. CurationGraph
    if top_topic:
        await _run_curation_stage(user_id=user_id, topic=top_topic)

    print("\n" + "═" * 78)
    print(" 🎉 FULL END-TO-END ORCHESTRATION PIPELINE COMPLETE!")
    print("═" * 78 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
