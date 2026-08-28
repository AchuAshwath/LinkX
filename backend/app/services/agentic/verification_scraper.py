"""Scraping primitives and DOM extraction helpers for VerificationGraph."""

from __future__ import annotations

import logging
from typing import Any

from app.services.agentic.session_recovery_graph import recover_page_session
from app.services.agentic.tools.common import get_active_page
from app.services.browser.actions import human_navigation, random_delay
from app.services.browser.manager import BrowserManager

logger = logging.getLogger(__name__)

__all__ = [
    "extract_profile_timeline_tweets",
    "scrape_x_profile_feed",
]


async def extract_profile_timeline_tweets(
    *, page: Any, limit: int = 5
) -> list[dict[str, Any]]:
    """Extract recent tweet DOM elements from X.com profile page."""
    tweets: list[dict[str, Any]] = []
    try:
        await page.wait_for_selector(
            "[data-testid='tweet']", state="visible", timeout=12000
        )
    except Exception:
        return tweets

    locators = page.locator("[data-testid='tweet']")
    count = await locators.count()

    for idx in range(min(count, limit)):
        tweet_loc = locators.nth(idx)
        try:
            text_loc = tweet_loc.locator("[data-testid='tweetText']")
            text = await text_loc.inner_text() if await text_loc.is_visible() else ""

            status_id: str | None = None
            links = tweet_loc.locator("a[href*='/status/']")
            link_count = await links.count()
            if link_count > 0:
                href = await links.first.get_attribute("href")
                if href and "/status/" in href:
                    status_id = href.split("/status/")[-1].split("?")[0]

            tweets.append({"status_id": status_id, "text": text.strip()})
        except Exception:
            continue

    return tweets


async def _navigate_x_profile(*, page: Any, username: str, mouse: Any | None) -> None:
    """Navigate to user profile page and handle sidebar navigation fallback."""
    profile_url = f"https://x.com/{username}" if username else "https://x.com/home"
    try:
        await human_navigation(page=page, url=profile_url)
    except Exception:
        await page.goto(profile_url, wait_until="domcontentloaded", timeout=20000)
    await recover_page_session(page=page, mouse=mouse)

    if not username and "/home" in page.url:
        try:
            profile_btn = page.locator("[data-testid='AppTabBar_Profile_Link']")
            if await profile_btn.is_visible():
                await profile_btn.click()
                await page.wait_for_timeout(2000)
        except Exception:
            pass


async def _scrape_direct_status_urls(
    *, page: Any, target_ext_ids: list[str], mouse: Any | None
) -> list[dict[str, Any]]:
    """Inspect specific status URLs directly in DOM to extract tweets."""
    tweets: list[dict[str, Any]] = []
    for eid in target_ext_ids:
        clean_id = eid.split("x:")[-1] if "x:" in eid else eid
        if not clean_id.isdigit():
            continue
        try:
            await page.goto(
                f"https://x.com/i/status/{clean_id}",
                wait_until="domcontentloaded",
                timeout=15000,
            )
            await recover_page_session(page=page, mouse=mouse)
            await page.wait_for_timeout(1500)
            direct_tweets = await extract_profile_timeline_tweets(page=page, limit=2)
            if direct_tweets:
                tweets.extend(direct_tweets)
        except Exception:
            pass
    return tweets


async def scrape_x_profile_feed(
    *,
    user_id: str,
    max_tweets: int,
    mouse: Any | None,
    headless: bool = True,
    target_ext_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Scrape timeline tweets from user's live X.com profile and status pages."""
    manager = BrowserManager(user_id=user_id)
    if not manager.session_exists("x"):
        return []

    meta = manager.read_session_metadata("x")
    username = meta.get("username", "")

    try:
        async with manager.get_context("x", headless=headless) as context:
            page = await get_active_page(context=context)
            await _navigate_x_profile(page=page, username=username, mouse=mouse)
            await random_delay(min_sec=1.0, max_sec=2.0)
            tweets = await extract_profile_timeline_tweets(page=page, limit=max_tweets)

            if target_ext_ids:
                status_tweets = await _scrape_direct_status_urls(
                    page=page, target_ext_ids=target_ext_ids, mouse=mouse
                )
                tweets.extend(status_tweets)

            return tweets
    except Exception as exc:
        logger.warning(f"Error scraping X profile feed for {user_id}: {exc}")
        return []
