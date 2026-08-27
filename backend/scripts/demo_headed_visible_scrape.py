"""Live Visible Headed Scraping Demonstration on macOS.

Brings Google Chrome directly to the FOREGROUND on your screen,
navigates through Explore Trends with natural human delays so you can visually watch
every step of the live perception process, and persists the extracted topics and tweets to PostgreSQL.

Usage:
    cd backend && uv run python scripts/demo_headed_visible_scrape.py [user_id]
"""

from __future__ import annotations

import asyncio
import platform
import subprocess
import sys
from pathlib import Path

# Add backend directory to sys.path
sys.path.append(str(Path(__file__).parent.parent))

from rebrowser_playwright.async_api import async_playwright
from sqlmodel import Session

from app.core.db import engine
from app.services.agentic.scraping_persistence import persist_scraped_batch_records
from app.services.browser.core import get_playwright_args, get_session_dir
from app.services.browser.diagnostics import detect_page_state, extract_grok_summary
from app.services.browser.manager import _clean_stale_singleton_locks
from scripts.scrape_trending_topics import (
    extract_topic_tweets,
    extract_trending_sidebar,
)


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


async def main() -> None:
    print("\n" + "=" * 76)
    print("🖥️  VISIBLE HEADED SCRAPE: Watch Chrome on your Desktop!")
    print("=" * 76)

    user_id = (
        sys.argv[1] if len(sys.argv) > 1 else "93c0700a-423f-42eb-8c91-0b90f300ca11"
    )
    session_dir = get_session_dir(user_id, "x")
    _clean_stale_singleton_locks(session_dir)

    print(f" • Session Dir: {session_dir}")
    print(" • Launching Google Chrome in HEADED mode...")

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(session_dir),
            headless=False,
            channel="chrome",
            viewport={"width": 1280, "height": 850},
            ignore_default_args=["--enable-automation"],
            args=get_playwright_args() + ["--window-position=50,50"],
            slow_mo=150,
        )

        page = context.pages[0] if context.pages else await context.new_page()
        for p_extra in context.pages[1:]:
            await p_extra.close()

        # Bring window to front
        _focus_chrome_on_macos()

        print("\n🌐 Step 1: Navigating to X.com Explore Trends...")
        await page.goto(
            "https://x.com/explore/tabs/trend", wait_until="domcontentloaded"
        )
        _focus_chrome_on_macos()

        # Give user time to see Explore page
        print("⏳ Waiting 4 seconds on Explore page so you can see live trends...")
        await page.wait_for_timeout(4000)

        page_state = await detect_page_state(page)
        print(f" • Page State: {page_state}")

        selectors = {
            "selectors": {
                "sidebar_container": "[data-testid='sidebarColumn'], [data-testid='primaryColumn'], main[role='main']",
                "sidebar_link": "[data-testid='trend'], a[href*='/search?q='], [data-testid^='news_sidebar_article']",
                "tweet_container": "[data-testid='tweet']",
            }
        }

        print("\n🔍 Step 2: Extracting Trending Topics from feed...")
        raw_topics = await extract_trending_sidebar(page, selectors=selectors)
        print(f" • Found {len(raw_topics)} trending topics on page!")

        scraped_topics = []
        topic_tweets_map = {}
        topic_summaries = {}

        for idx, t in enumerate(raw_topics[:2], 1):
            title = t.topic_title or "Untitled"
            url = t.topic_url or ""
            print(f'\n👉 [{idx}] Navigating to topic: "{title}"')
            print(f"   URL: {url}")

            scraped_topics.append(
                {
                    "topic_title": title,
                    "title": title,
                    "topic_url": url,
                    "url": url,
                    "category": t.category,
                    "post_count": t.post_count,
                }
            )

            # Navigate to topic
            await page.goto(url, wait_until="domcontentloaded")
            _focus_chrome_on_macos()

            # Pause to show timeline
            print("   ⏳ Showing topic timeline on screen for 4 seconds...")
            await page.wait_for_timeout(4000)

            # Extract Grok summary
            summary = await extract_grok_summary(page)
            if summary:
                print(f"   📝 Grok Summary: {summary[:90]}...")
                topic_summaries[url] = summary

            # Extract top tweets
            tweets = await extract_topic_tweets(
                page, topic_url=url, selectors=selectors
            )
            print(f"   🐦 Collected {len(tweets)} tweets!")
            for _tw_idx, tw in enumerate(tweets[:2], 1):
                author = tw.author_handle or "Unknown"
                text = (tw.text or "").replace("\n", " ")
                print(f"      • @{author}: {text[:75]}...")

            topic_tweets_map[url] = [
                {
                    "author_handle": tw.author_handle,
                    "text": tw.text,
                    "replies": tw.replies,
                    "retweets": tw.retweets,
                    "likes": tw.likes,
                    "views": tw.views,
                }
                for tw in tweets
            ]

        print("\n💾 Step 3: Persisting Scraped Batch to PostgreSQL...")
        with Session(engine) as session:
            persisted_topics, persisted_tweets, errors = persist_scraped_batch_records(
                user_id_raw=user_id,
                session_arg=session,
                scraped_topics=scraped_topics,
                topic_tweets_map=topic_tweets_map,
                topic_summaries=topic_summaries,
            )
            print(f" • Topics Persisted in PostgreSQL: {persisted_topics}")
            print(f" • Tweets Persisted in PostgreSQL: {persisted_tweets}")

        print("\n⏳ Keeping Chrome open for 3 seconds before closing...")
        await page.wait_for_timeout(3000)
        await context.close()

    print("\n" + "=" * 76)
    print("✅ Visible Headed Scrape Complete!")
    print("=" * 76 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
