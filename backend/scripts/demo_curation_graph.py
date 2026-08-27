"""Standalone Demonstration for CurationGraph (Tier 2 Domain Orchestrator).

Takes the latest real trending topic and tweets from PostgreSQL (populated by ScrapingGraph),
runs the CurationGraph (context gathering, platform-specific drafting, and DraftRefinementGraph polishing),
and saves the post to PostgreSQL with status="draft" (HITL gate).

Usage:
    cd backend && uv run python scripts/demo_curation_graph.py [user_id] [topic_id_or_title]
"""

from __future__ import annotations

# ruff: noqa: E402
import asyncio
import logging
import os
import sys
import time

# Silence verbose third-party HTTP & LiteLLM logs for clean terminal output
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
os.environ["LITELLM_LOG"] = "ERROR"
logging.basicConfig(level=logging.WARNING, force=True)
logging.getLogger().setLevel(logging.WARNING)


import litellm

litellm.suppress_debug_info = True
litellm.set_verbose = False
logging.getLogger("litellm").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)


# Add backend directory to sys.path
import os

os.environ.setdefault("POSTGRES_SERVER", "localhost")
sys.path.append(str(Path(__file__).parent.parent))

from sqlmodel import Session, create_engine, select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.db import engine  # noqa: E402
from app.models import Post, TrendingTopic, TrendingTweet, User  # noqa: E402
from app.services.agentic import curate_and_draft_post  # noqa: E402
from app.services.agentic.tools.context_tools import (
    get_social_account_status,  # noqa: E402
)


def _get_engine():
    """Resolve database engine for local host development or docker environment."""
    uri = str(settings.SQLALCHEMY_DATABASE_URI)
    if "@db:" in uri or "@db/" in uri:
        uri = uri.replace("@db:", "@localhost:").replace("@db/", "@localhost/")
        return create_engine(uri)
    return engine


db_engine = _get_engine()


def _print_banner() -> None:
    """Print demo run banner."""
    print("\n" + "═" * 78)
    print(" ✍️  LINKX AGENTIC AI CURATION & DRAFTING ORCHESTRATION")
    print("═" * 78)
    print(
        " Engine: CurationGraph + DraftRefinementGraph + PostgreSQL + Gemini 3.7 Flash\n"
    )


def _get_target_topic(topic_arg: str | None) -> TrendingTopic | None:
    """Find trending topic by ID/title or fallback to latest scraped topic."""
    with Session(db_engine) as session:
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
    _print_banner()

    user_id_arg = sys.argv[1] if len(sys.argv) > 1 else None
    topic_arg = sys.argv[2] if len(sys.argv) > 2 else None

    with Session(db_engine) as session:
        first_user = session.exec(select(User)).first()
        user_id = user_id_arg or (
            str(first_user.id) if first_user else "93c0700a-423f-42eb-8c91-0b90f300ca11"
        )

    topic = _get_target_topic(topic_arg)
    if not topic:
        print("❌ No trending topic found in PostgreSQL. Run scraping first!")
        return

    with Session(db_engine) as session:
        tweets = session.exec(
            select(TrendingTweet).where(TrendingTweet.topic_id == topic.id)
        ).all()

    # Step 1: Trending Topic Discovery
    print("┌" + "─" * 76 + "┐")
    print(
        "│ STEP 1: TRENDING TOPIC & TWEET CONTEXT (FROM POSTGRESQL)                   │"
    )
    print("└" + "─" * 76 + "┘")
    print(f" • Topic Title:   {topic.topic_title}")
    print(f" • Topic ID:      {topic.id}")
    print(f" • Category:      {topic.category or 'N/A'}")
    print(f" • Post Count:    {topic.post_count or 0:,}")
    print(f" • Scraped At:    {topic.scraped_at}")
    print(f" • Grok Summary:  {topic.summary or 'None'}")
    print(f" • Sample Tweets: {len(tweets)} tweets loaded from database")

    if tweets:
        print("\n 💬 Sample Timeline Tweet Data:")
        for idx, tw in enumerate(tweets[:3], 1):
            likes_str = f"{tw.likes or 0:,} likes"
            clean_text = tw.text.replace("\n", " ")[:90]
            print(f'    {idx}. {tw.author_handle}: "{clean_text}..." ({likes_str})')

    # Step 2: User Context & Platform Constraints
    with Session(db_engine) as session:
        account_status = get_social_account_status(user_id=user_id, session=session)
    char_limit = 25000 if account_status.x_is_premium else 280

    print("\n┌" + "─" * 76 + "┐")
    print(
        "│ STEP 2: CONTEXT GATHERING & CONSTRAINTS                                    │"
    )
    print("└" + "─" * 76 + "┘")
    print(f" • User ID:           {user_id}")
    print(" • Target Platform:   X (Twitter)")
    print(
        f" • Account Tier:      {'X Premium (Long-form)' if account_status.x_is_premium else 'X Standard (280 char limit)'}"
    )
    print(f" • Strict Char Limit: {char_limit} characters")
    print(" • Target Tone:       engaging, punchy, insightful")

    # Step 3 & 4: Execution of CurationGraph
    print("\n┌" + "─" * 76 + "┐")
    print(
        "│ STEP 3 & 4: RUNNING CURATIONGRAPH & DRAFTREFINEMENTGRAPH                   │"
    )
    print("└" + "─" * 76 + "┘")
    print(
        " ⏳ Generating multi-channel draft with Gemini AI and refining compliance..."
    )

    start_time = time.time()
    try:
        with Session(db_engine) as session:
            report = await curate_and_draft_post(
                user_id=user_id,
                topic_title=topic.topic_title,
                topic_id=str(topic.id),
                platform="x",
                target_tone="engaging, punchy, insightful",
                thread_id=f"demo-curation-{int(time.time())}",
                session=session,
            )
        duration = round(time.time() - start_time, 2)

        print(f" ✅ Finished in {duration}s | Status: {report.status}")
        print(f" • Constraint Compliant: {report.is_compliant}")
        print(f" • Refinement Attempts:  {report.refinement_attempts}")

        print("\n 📝 Raw AI Draft (Initial Generation):")
        print("    " + report.draft_content.replace("\n", "\n    "))

        print("\n ✨ Final Refined Copy (Platform Compliant & Polished):")
        print("    " + report.refined_content.replace("\n", "\n    "))

        char_len = len(report.refined_content)
        print(
            f"\n 📏 Length Check: {char_len} / {char_limit} chars ({'PASS ✅' if char_len <= char_limit else 'FAIL ❌'})"
        )

        # Step 5: PostgreSQL Database Persistence Verification
        print("\n┌" + "─" * 76 + "┐")
        print(
            "│ STEP 5: POSTGRESQL PERSISTENCE & HUMAN-IN-THE-LOOP (HITL) GATE             │"
        )
        print("└" + "─" * 76 + "┘")

        if report.persisted_post_id:
            with Session(db_engine) as session:
                post = session.get(Post, report.persisted_post_id)
                if post:
                    print(f" • Post ID:        {post.id}")
                    print(
                        f" • Status:         {post.status.upper()} (Awaiting user review in LinkX dashboard)"
                    )
                    print(f" • Creation Method:{post.method}")
                    print(f" • Platform:       {post.platform}")
                    print(f" • Scheduled At:   {post.scheduled_at or 'Unscheduled'}")
                    print(" • Database State: Verified in 'post' table ✅")
        else:
            print(" ⚠️ Draft persistence failed or skipped.")

        print("\n" + "═" * 78)
        print(" 🎉 DEMONSTRATION COMPLETE: POST DRAFT IS READY FOR REVIEW")
        print("═" * 78 + "\n")

    except Exception as exc:
        print(f"\n❌ CurationGraph failed with exception: {exc}")
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
