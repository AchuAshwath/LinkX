"""Live Browser Scraping and Environmental Perception Tools for LinkX Agentic Supervisor."""

from __future__ import annotations

import logging
from typing import Any

from app.services.agentic.tools.common import get_active_page
from app.services.browser.actions import human_navigation, random_delay
from app.services.browser.diagnostics import extract_grok_summary
from app.services.browser.manager import BrowserManager
from scripts.scrape_trending_topics import extract_topic_tweets, scrape_trending_topics

logger = logging.getLogger(__name__)


async def scrape_live_explore_trends(
    *,
    user_id: str,
    max_topics: int = 3,
    headless: bool = True,
) -> dict[str, Any]:
    """Execute live stealth scraping on X.com Explore, auto-heal broken selectors,
    and persist trending topics + Grok summaries to PostgreSQL."""
    try:
        result = await scrape_trending_topics(
            user_id=user_id,
            max_topics=max_topics,
            headless=headless,
        )
        return {
            "status": result.status,
            "topics_found": result.topics_found,
            "topics_scraped": result.topics_scraped,
            "errors": result.errors,
        }
    except Exception as e:
        logger.error(f"Error during scrape_live_explore_trends: {e}")
        return {
            "status": "error",
            "topics_found": 0,
            "topics_scraped": 0,
            "errors": [str(e)],
        }


async def scrape_topic_timeline(
    *,
    topic_url: str,
    user_id: str,
    max_tweets: int = 5,
) -> dict[str, Any]:
    """Navigate directly to a specific topic URL on live X, extract Grok summary & top tweets."""
    manager = BrowserManager(user_id=user_id)
    if not manager.session_exists("x"):
        return {
            "success": False,
            "error": "X session not connected.",
            "tweets": [],
            "grok_summary": "",
        }

    try:
        async with manager.get_context("x", headless=True) as context:
            page = await get_active_page(context=context)

            try:
                await human_navigation(page=page, url=topic_url)
            except Exception:
                await page.goto(topic_url, wait_until="domcontentloaded", timeout=20000)

            await random_delay(min_sec=1.0, max_sec=2.0)
            summary = await extract_grok_summary(page)

            # Use modular extractor — pass page.url to avoid re-navigation
            # since human_navigation already landed us on the topic page
            # (X.com may redirect to a slightly different final URL)
            raw_tweets = await extract_topic_tweets(
                page=page,
                topic_url=page.url,
                selectors={},
            )

            tweets_data = [
                {
                    "author": t.author_handle,
                    "text": t.text,
                    "likes": t.likes or 0,
                    "retweets": t.retweets or 0,
                    "replies": t.replies or 0,
                    "views": t.views or 0,
                }
                for t in raw_tweets[:max_tweets]
            ]

            return {
                "success": True,
                "topic_url": topic_url,
                "grok_summary": summary,
                "tweets": tweets_data,
            }
    except Exception as e:
        logger.error(f"Error scraping topic timeline {topic_url}: {e}")
        return {
            "success": False,
            "error": str(e),
            "tweets": [],
            "grok_summary": "",
        }


async def inspect_page_session_state(
    *,
    user_id: str,
    platform: str = "x",
) -> dict[str, Any]:
    """Inspect active browser session against live sentinel elements to classify page state."""
    try:
        manager = BrowserManager(user_id=user_id)
        session_report = await manager.verify_session(platform_name=platform)
        return session_report
    except Exception as e:
        logger.error(f"Error inspecting page session state for {user_id}: {e}")
        return {
            "connected": False,
            "authenticated": False,
            "page_state": "error",
            "error": str(e),
        }
