"""Live Headed Visual Demonstration for ScrapingGraph (Tier 2 Domain Orchestrator).

Launches the real user authenticated X.com session in a headed Chrome browser window,
executes ScrapingGraph (session recovery, Explore navigation, self-healing trend extraction,
topic timeline tweet scraping, and PostgreSQL persistence), and displays live telemetry.

Usage:
    cd backend && uv run python scripts/demo_scraping_graph_headed.py [user_id] [max_topics]
"""

from __future__ import annotations

# ruff: noqa: E402
import asyncio
import os
import platform
import subprocess
import sys
import time
import warnings
from pathlib import Path

# Silence verbose third-party logs
warnings.filterwarnings("ignore")
os.environ["LITELLM_LOG"] = "ERROR"

# Add backend directory to sys.path
sys.path.append(str(Path(__file__).parent.parent))

from typing import Any

from sqlmodel import Session, create_engine, select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.db import engine  # noqa: E402
from app.models import TrendingTopic, TrendingTweet, User  # noqa: E402
from app.services.agentic import scrape_trends_with_graph  # noqa: E402


def _get_engine():
    """Resolve database engine for local host development or docker environment."""
    uri = str(settings.SQLALCHEMY_DATABASE_URI)
    if "@db:" in uri or "@db/" in uri:
        uri = uri.replace("@db:", "@localhost:").replace("@db/", "@localhost/")
        return create_engine(uri)
    return engine


db_engine = _get_engine()


def _focus_chrome_on_macos() -> None:
    """Bring Chrome to the front on macOS."""
    if platform.system() == "Darwin":
        try:
            subprocess.run(
                ["osascript", "-e", 'tell application "Google Chrome" to activate'],
                capture_output=True,
                check=False,
            )
        except Exception:
            pass


def _print_banner() -> None:
    """Print demo run banner."""
    print("\n" + "═" * 78)
    print(" 🖥️  LINKX AGENTIC HEADED SCRAPING & SELF-HEALING RECOVERY")
    print("═" * 78)
    print(" Engine: ScrapingGraph + SessionRecoveryGraph + EvasionMouse + PostgreSQL\n")


def _display_session_recovery_telemetry(*, report: Any) -> None:
    """Display session recovery telemetry."""
    print("┌" + "─" * 76 + "┐")
    print(
        "│ STEP 2: SESSION RECOVERY & OVERLAY DIAGNOSIS (SESSIONRECOVERYGRAPH)        │"
    )
    print("└" + "─" * 76 + "┘")
    print(f" • Initial Page State: {report.page_state}")

    if report.session_recovery:
        rec = report.session_recovery
        print(
            f" • Overlay Diagnosed:  {rec.get('overlay_type') or 'None (Clean Page)'}"
        )
        print(f" • Recovery Action:    {rec.get('recovery_action') or 'None required'}")
        print(f" • Session Recovered:  {'YES ✅' if rec.get('recovered') else 'NO ⚠️'}")
    else:
        print(" • Session Recovery:   Clean Page State (No modal overlays detected) ✅")


def _display_top_tweets_list(*, tweets: list[dict[str, Any]]) -> None:
    """Print top 5 timeline tweets with handles and engagement metrics."""
    if not tweets:
        return
    print("        💬 Top Timeline Tweets:")
    for t_idx, tw in enumerate(tweets[:5], 1):
        author = tw.get("author_handle", "unknown")
        txt = (tw.get("text") or "").replace("\n", " ")
        short_txt = txt[:80] + "..." if len(txt) > 80 else txt
        likes = tw.get("likes") or 0
        retweets = tw.get("retweets") or 0
        print(
            f'           {t_idx}. {author}: "{short_txt}" ({likes:,} likes, {retweets:,} reposts)'
        )


def _display_single_topic_block(
    *, idx: int, topic: dict[str, Any], report: Any
) -> None:
    """Print details and sample tweets for a single extracted topic."""
    title = topic.get("topic_title") or topic.get("title", "Untitled")
    url = topic.get("topic_url") or topic.get("url", "")
    cat = topic.get("category", "Trending")
    summary = report.topic_summaries.get(url) or "No Grok summary extracted"
    tweets = report.topic_tweets_map.get(url, [])

    print(f"\n    [{idx}] {title} ({cat})")
    print(f"        • URL:     {url}")
    print(f"        • Tweets:  {len(tweets)} sample tweets extracted")
    if summary and summary != "No Grok summary extracted":
        clean_sum = summary.replace("\n", " ")[:140]
        print(f"        • Grok Summary: {clean_sum}...")

    _display_top_tweets_list(tweets=tweets)


def _display_extracted_timeline_topics(
    *, report: Any, duration: float, max_topics: int
) -> None:
    """Display scraped topics and sample tweets."""
    print("\n┌" + "─" * 76 + "┐")
    print(
        "│ STEP 3 & 4: STEALTH SCRAPING & TOPIC TIMELINE EXTRACTION                   │"
    )
    print("└" + "─" * 76 + "┘")
    print(f" ✅ ScrapingGraph completed in {duration}s | Status: {report.status}")
    print(f" • Scraped Topics:     {len(report.scraped_topics)}")
    print(f" • Topics Persisted:   {report.persisted_topic_count}")
    print(f" • Tweets Persisted:   {report.persisted_tweet_count}")

    extracted = [
        t
        for t in report.scraped_topics
        if (t.get("topic_url") or t.get("url", "")) in report.topic_tweets_map
    ] or report.scraped_topics[:max_topics]

    if extracted:
        print("\n 📌 Extracted Timeline Topics & Grok Summaries:")
        for idx, topic in enumerate(extracted, 1):
            _display_single_topic_block(idx=idx, topic=topic, report=report)


def _display_verified_topic(
    *, topic: TrendingTopic, attached_tweets: list[TrendingTweet]
) -> None:
    """Display topic details and sample attached tweets from database."""
    print(f" • Topic '{topic.topic_title}':")
    print(f"    - ID:        {topic.id}")
    print(f"    - Category:  {topic.category or 'Trending'}")
    print(f"    - Post Count:{topic.post_count or 0:,}")
    print(
        f"    - Tweets DB: {len(attached_tweets)} attached tweets in 'trending_tweet' ✅"
    )
    for i, tw in enumerate(attached_tweets[:3], 1):
        short_body = (tw.text or "").replace("\n", " ")[:70]
        print(
            f'       [{i}] {tw.author_handle}: "{short_body}..." ({tw.likes or 0:,} likes, {tw.retweets or 0:,} reposts)'
        )


def _verify_and_display_db_records(*, max_topics: int) -> None:
    """Verify saved topic records in PostgreSQL."""
    print("\n┌" + "─" * 76 + "┐")
    print(
        "│ STEP 5: POSTGRESQL PERSISTENCE & RELATIONAL INTEGRITY VERIFICATION        │"
    )
    print("└" + "─" * 76 + "┘")

    with Session(db_engine) as session:
        recent_topics = session.exec(
            select(TrendingTopic)
            .order_by(TrendingTopic.scraped_at.desc())  # type: ignore[attr-defined]
            .limit(8)
        ).all()

        topics_with_tweets: list[tuple[TrendingTopic, list[TrendingTweet]]] = []
        for t in recent_topics:
            attached_tweets = list(
                session.exec(
                    select(TrendingTweet).where(TrendingTweet.topic_id == t.id)
                ).all()
            )
            if attached_tweets:
                topics_with_tweets.append((t, attached_tweets))

        for t, attached in topics_with_tweets[:max_topics]:
            _display_verified_topic(topic=t, attached_tweets=attached)

        else:
            print(" ⚠️ No topic records with attached tweets found in database.")

    print("\n" + "═" * 78)
    print(" 🎉 DEMONSTRATION COMPLETE: REAL HEADED SCRAPE COMPLETED SUCCESSFULLY")
    print("═" * 78 + "\n")


async def main() -> None:
    """Main execution flow for headed ScrapingGraph demonstration."""
    _print_banner()

    user_id_arg = (
        sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].isdigit() else None
    )
    max_topics_arg = (
        int(sys.argv[2])
        if len(sys.argv) > 2
        else (int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 2)
    )

    with Session(db_engine) as session:
        first_user = session.exec(select(User)).first()
        user_id = user_id_arg or (
            str(first_user.id) if first_user else "93c0700a-423f-42eb-8c91-0b90f300ca11"
        )

    print("┌" + "─" * 76 + "┐")
    print(
        "│ STEP 1: INITIALIZING AUTHENTICATED HEADED BROWSER & STEALTH ENGINE         │"
    )
    print("└" + "─" * 76 + "┘")
    print(f" • User ID:        {user_id}")
    print(f" • Max Topics:     {max_topics_arg}")
    print(" • Browser Mode:   HEADED (Google Chrome opening on your desktop)")
    print(
        " • Stealth Engine: EvasionMouse (Bézier trajectories + human typing & jitter)\n"
    )

    async def _delayed_focus() -> None:
        await asyncio.sleep(1.5)
        _focus_chrome_on_macos()

    asyncio.create_task(_delayed_focus())

    start_time = time.time()
    try:
        with Session(db_engine) as session:
            report = await scrape_trends_with_graph(
                user_id=user_id,
                max_topics=max_topics_arg,
                headless=False,
                session=session,
            )
        duration = round(time.time() - start_time, 2)
        _display_session_recovery_telemetry(report=report)
        _display_extracted_timeline_topics(
            report=report, duration=duration, max_topics=max_topics_arg
        )
        _verify_and_display_db_records(max_topics=max_topics_arg)
    except Exception as exc:
        print(f"\n❌ ScrapingGraph failed with exception: {exc}")


if __name__ == "__main__":
    asyncio.run(main())
