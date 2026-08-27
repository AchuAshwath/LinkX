"""Live Headed Visual Demonstration for ScrapingGraph (Tier 2 Domain Orchestrator).

Launches the real user authenticated X.com session in a headed Chrome browser window,
executes ScrapingGraph (session recovery, Explore navigation, self-healing trend extraction,
topic timeline tweet scraping, and PostgreSQL persistence), and displays live telemetry.

Usage:
    cd backend && uv run python scripts/demo_scraping_graph_headed.py
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

# Add backend directory to sys.path
sys.path.append(str(Path(__file__).parent.parent))

from app.services.agentic import scrape_trends_with_graph


async def main() -> None:
    print("=" * 72)
    print("🖥️  HEADED DEMO: ScrapingGraph Autonomous Trend Extraction")
    print("=" * 72)
    print("Launching authenticated Chrome session in HEADED mode...\n")

    user_id = (
        sys.argv[1] if len(sys.argv) > 1 else "93c0700a-423f-42eb-8c91-0b90f300ca11"
    )
    max_topics = int(sys.argv[2]) if len(sys.argv) > 2 else 2

    start_time = time.time()
    try:
        report = await scrape_trends_with_graph(
            user_id=user_id,
            max_topics=max_topics,
            headless=False,
        )

        duration = round(time.time() - start_time, 2)
        print("\n" + "=" * 72)
        print(f"📊 SCRAPINGGRAPH EXECUTION COMPLETED ({duration}s)")
        print("=" * 72)
        print(f"Status:             {report.status}")
        print(f"Page State:         {report.page_state}")
        print(f"Topics Scraped:     {len(report.scraped_topics)}")
        print(f"Topics Persisted:   {report.persisted_topic_count}")
        print(f"Tweets Persisted:   {report.persisted_tweet_count}")

        if report.session_recovery:
            print(
                f"Session Recovery:   {report.session_recovery.get('recovery_action')} (Recovered: {report.session_recovery.get('recovered')})"
            )

        if report.failed_topics:
            print(f"Failed Topics:      {report.failed_topics}")

        if report.error:
            print(f"Error:              {report.error}")

        print("\n📌 Extracted Topics Summary:")
        for idx, topic in enumerate(report.scraped_topics, 1):
            title = topic.get("topic_title") or topic.get("title", "Untitled")
            url = topic.get("topic_url") or topic.get("url", "")
            summary = report.topic_summaries.get(url, "No Grok summary extracted")
            tweets = report.topic_tweets_map.get(url, [])

            print(f"\n  [{idx}] {title}")
            print(f"      URL:     {url}")
            print(
                f"      Summary: {summary[:120]}..."
                if len(summary) > 120
                else f"      Summary: {summary}"
            )
            print(f"      Tweets:  {len(tweets)} collected")
            for _t_idx, tweet in enumerate(tweets[:2], 1):
                author = tweet.get("author_handle") or tweet.get("author", "Unknown")

                text = (tweet.get("text") or "").replace("\n", " ")
                print(
                    f"        • [{author}] {text[:90]}..."
                    if len(text) > 90
                    else f"        • [{author}] {text}"
                )

        print("\n" + "=" * 72)

    except Exception as exc:
        print(f"\n❌ ScrapingGraph failed with exception: {exc}")
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
