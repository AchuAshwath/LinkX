"""Scrape trending news topics from X.com sidebar.

This script is designed to be called by a LangGraph orchestration agent.
It returns a structured ScrapeResult dataclass so the agent can branch
on status without parsing log output.

Anti-detection measures:
  - Randomized topic visit order
  - Reading simulation (random pauses between tweet extractions)
  - Random scrolling and idle behavior via EvasionMouse
  - Human-like delays between all interactions
"""

import asyncio
import json
import logging
import os
import random
import re
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# Add backend to path so we can run from anywhere
sys.path.append(str(Path(__file__).parent.parent))

from rebrowser_playwright.async_api import Error as PlaywrightError
from sqlmodel import Session, select

from app import crud
from app.core.config import settings
from app.core.db import engine
from app.models import User
from app.services.browser.actions import EvasionMouse, random_delay
from app.services.browser.diagnostics import detect_page_state, extract_grok_summary
from app.services.browser.manager import BrowserManager

logging.basicConfig(level=logging.DEBUG, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Structured result types — so LangGraph can branch with a single tool call
# ---------------------------------------------------------------------------


@dataclass
class TopicFailure:
    """Records why a single topic failed to scrape."""

    topic_id: str
    reason: str  # "timeout" | "page_state_error" | "no_tweets" | "exception"
    detail: str = ""


@dataclass
class ScrapeResult:
    """Structured result from a scrape run.

    A LangGraph agent can branch on `status` without parsing logs:
      - "success"      → all requested topics scraped
      - "partial"      → some topics scraped, some failed
      - "no_topics"    → sidebar had no news topics
      - "auth_failed"  → session expired, login required
      - "rate_limited" → X.com rate limit or error page
      - "captcha"      → CAPTCHA challenge detected
      - "aborted"      → browser was closed or crashed
      - "error"        → unexpected exception
    """

    status: str
    topics_found: int = 0
    topics_scraped: int = 0
    topics_failed: list[TopicFailure] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Tweet extraction
# ---------------------------------------------------------------------------

MAX_TWEETS_PER_AUTHOR = 2


async def _expand_tweet(locator) -> None:
    """Click the 'Show more' link inside a tweet article if present.

    X.com truncates long tweets with a clickable span that is *not* a button.
    We try the stable data-testid first, then fall back to text-matching.
    Errors are swallowed — short tweets have no 'Show more' and that's fine.
    """
    try:
        show_more = locator.locator('[data-testid="tweet-text-show-more-link"]')
        if await show_more.count() > 0:
            await show_more.first.click(timeout=3000)
            await locator.page.wait_for_timeout(400)
            return
        # Fallback: plain span with text "Show more"
        fallback = locator.locator("span").filter(has_text="Show more")
        if await fallback.count() > 0:
            await fallback.first.click(timeout=3000)
            await locator.page.wait_for_timeout(400)
    except PlaywrightError:
        pass  # No expansion needed for short tweets


async def extract_tweet_data(locator) -> dict | None:
    """Parse author, full text, and raw content from a tweet article locator.

    Expands truncated tweets by clicking 'Show more' before reading text.
    Catches only Playwright errors (stale elements, closed pages).
    Raises unexpected exceptions so bugs are not silently swallowed.
    """
    try:
        # Expand truncated tweet text before reading
        await _expand_tweet(locator)

        # Use .first because quote-tweets can have 2 tweetText elements
        text_element = locator.locator('[data-testid="tweetText"]').first
        text = await text_element.inner_text() if await text_element.count() > 0 else ""

        full_text = await locator.inner_text()

        # Guess author handle from lines starting with @
        lines = [line.strip() for line in full_text.split("\n") if line.strip()]
        author = next((line for line in lines if line.startswith("@")), "Unknown")

        if not text:
            text = full_text

        return {"author": author, "text": text, "raw": full_text}
    except PlaywrightError as e:
        # Recoverable — element probably went stale during extraction
        logger.warning(f"Playwright error extracting tweet: {e}")
        return None


# ---------------------------------------------------------------------------
# Title metadata parsing
# ---------------------------------------------------------------------------


def parse_title_metadata(
    raw_title: str,
) -> dict:
    """Parse the raw sidebar title block into structured fields.

    X.com formats sidebar news titles as:
        "Headline text\\nTime ago · Category · N posts"

    Some topics may have extra lines or missing metadata fields.
    """
    clean_title = raw_title
    time_ago = None
    category = None
    post_count = None
    extra_lines: list[str] = []

    if "\n" in raw_title:
        parts = raw_title.split("\n")
        clean_title = parts[0].strip()

        # The second line typically has "time · category · count"
        if len(parts) > 1:
            meta_parts = [p.strip() for p in parts[1].split("·")]
            if len(meta_parts) >= 1:
                time_ago = meta_parts[0] if meta_parts[0] else None
            if len(meta_parts) >= 2:
                category = meta_parts[1] if meta_parts[1] else None
            if len(meta_parts) >= 3:
                post_count = meta_parts[2] if meta_parts[2] else None

        # Capture any additional lines (e.g., "Trending in India")
        if len(parts) > 2:
            extra_lines = [p.strip() for p in parts[2:] if p.strip()]

    return {
        "topic_title": clean_title,
        "time_ago": time_ago,
        "category": category,
        "post_count": post_count,
        "extra_metadata": extra_lines if extra_lines else None,
        "raw_title_block": raw_title,
    }


def parse_post_count(count_str: str | None) -> int | None:
    if not count_str:
        return None
    clean = (
        count_str.lower()
        .replace("posts", "")
        .replace("post", "")
        .replace(",", "")
        .strip()
    )
    if not clean:
        return None
    try:
        if "k" in clean:
            return int(float(clean.replace("k", "")) * 1000)
        elif "m" in clean:
            return int(float(clean.replace("m", "")) * 1000000)
        return int(clean)
    except ValueError:
        logger.warning(f"Failed to parse post count: {count_str}")
        return None


def parse_relative_time(time_str: str | None, base_time: datetime) -> datetime | None:
    if not time_str:
        return None
    clean = time_str.lower().strip()
    try:
        if "hour" in clean:
            match = re.search(r"(\d+)", clean)
            hours = int(match.group(1)) if match else 1
            return base_time - timedelta(hours=hours)
        elif "minute" in clean:
            match = re.search(r"(\d+)", clean)
            minutes = int(match.group(1)) if match else 1
            return base_time - timedelta(minutes=minutes)
        elif "day" in clean:
            match = re.search(r"(\d+)", clean)
            days = int(match.group(1)) if match else 1
            return base_time - timedelta(days=days)
        elif "yesterday" in clean:
            return base_time - timedelta(days=1)
        return None
    except Exception:
        logger.warning(f"Failed to parse relative time: {time_str}")
        return None


def parse_engagement_metrics(raw_text: str) -> dict[str, int | None]:
    """Parse engagement metrics from a tweet's raw inner text.

    Assumes X.com renders the last 4 non-empty lines as
    (from bottom): views, likes, retweets, replies.
    If the format changes, metrics will silently be wrong —
    log a warning when an unexpected line count is seen.
    """

    def parse_metric(val: str) -> int | None:
        clean = val.lower().replace(",", "").strip()
        try:
            if "k" in clean:
                return int(float(clean.replace("k", "")) * 1000)
            elif "m" in clean:
                return int(float(clean.replace("m", "")) * 1000000)
            return int(clean)
        except ValueError:
            return None

    lines = [line.strip() for line in raw_text.split("\n") if line.strip()]
    if len(lines) < 4:
        return {"replies": None, "retweets": None, "likes": None, "views": None}

    if len(lines) > 6:
        logger.warning(
            f"Unexpected line count ({len(lines)}) in tweet raw text — "
            "engagement metric parsing may be inaccurate."
        )

    metrics = {}
    metrics["views"] = parse_metric(lines[-1])
    metrics["likes"] = parse_metric(lines[-2])
    metrics["retweets"] = parse_metric(lines[-3])
    metrics["replies"] = parse_metric(lines[-4])
    return metrics


# ---------------------------------------------------------------------------
# Reading simulation — makes the scraper look like a human browsing
# ---------------------------------------------------------------------------


async def simulate_reading(mouse: EvasionMouse) -> None:
    """Randomly pause and scroll to simulate a human reading tweets.

    Called between tweet extractions to break up the scraping pattern.
    """
    # 40% chance to pause as if reading a tweet
    if random.random() < 0.4:
        await random_delay(min_sec=1.5, max_sec=4.0)

    # 25% chance to scroll a little (as if reading more content)
    if random.random() < 0.25:
        await mouse.human_scroll(scrolls=1)
        await random_delay(min_sec=0.5, max_sec=1.5)

    # 10% chance of a longer idle (checking phone, thinking, etc.)
    if random.random() < 0.10:
        await random_delay(min_sec=3.0, max_sec=7.0)


# ---------------------------------------------------------------------------
# Main scraping logic
# ---------------------------------------------------------------------------


def _is_valid_topic_text(
    text: str,
    heuristic: dict[str, Any],
) -> bool:
    """Validate topic text against heuristics."""
    if heuristic.get("must_contain_newline", True) and "\n" not in text:
        return False
    prefix = heuristic.get("exclude_prefix", "@")
    if prefix and text.startswith(prefix):
        return False
    exclude_texts = heuristic.get("exclude_texts", ["Show more", "Subscribe"])
    return not any(ex in text for ex in exclude_texts)


async def _extract_sidebar_links(
    sidebar: Any,
    link_selector: str,
    heuristic: dict[str, Any],
) -> tuple[list[tuple[str, bool]], dict[str, str]]:
    """Extract valid sidebar news links according to heuristics."""
    all_links = await sidebar.locator(link_selector).all()
    news_urls: list[tuple[str, bool]] = []
    news_titles: dict[str, str] = {}

    for link in all_links:
        try:
            text = await link.inner_text()
            url = await link.get_attribute("href")
            testid = await link.get_attribute("data-testid")
            identifier = url or testid
            if not identifier:
                continue
            if identifier in news_titles:
                continue
            if not _is_valid_topic_text(text, heuristic):
                continue

            news_urls.append((identifier, bool(url)))
            news_titles[identifier] = text
        except Exception:
            continue

    return news_urls, news_titles


async def _scrape_topic_tweets(
    page: Any,
    mouse: Any,
    tweet_selector: str,
    scrolls_per_topic: int,
) -> list[dict]:
    """Scrape top tweets with human reading simulation."""
    conversations: list[dict] = []
    author_counts: dict[str, int] = {}
    remaining_scrolls = scrolls_per_topic

    while len(conversations) < 5 and remaining_scrolls >= 0:
        tweets = await page.locator(tweet_selector).all()
        for t in tweets:
            data = await extract_tweet_data(t)
            if not data:
                continue

            if data["raw"] in [c["raw"] for c in conversations]:
                continue

            author = data["author"]
            current_count = author_counts.get(author, 0)
            if current_count >= MAX_TWEETS_PER_AUTHOR:
                continue

            conversations.append(data)
            author_counts[author] = current_count + 1
            await simulate_reading(mouse)

            if len(conversations) >= 5:
                break

        if len(conversations) < 5 and remaining_scrolls > 0:
            await mouse.human_scroll(scrolls=1)
            await random_delay(min_sec=1.0, max_sec=3.0)

        remaining_scrolls -= 1

    return conversations[:5]


@dataclass
class TopicRecordPayload:
    """Payload bundle for saving scraped topic records."""

    db_user_id: Any
    topic_url: str
    title_data: dict[str, Any]
    summary_text: str | None
    conversations: list[dict[str, Any]]
    scraped_at: datetime


def _save_topic_record(payload: TopicRecordPayload) -> None:
    """Save scraped topic and tweets to database."""
    if not payload.db_user_id:
        logger.error("No default user found. Skipping DB save.")
        return

    with Session(engine) as session:
        db_topic_data = {
            "user_id": payload.db_user_id,
            "topic_url": payload.topic_url,
            "topic_title": payload.title_data["topic_title"],
            "category": payload.title_data.get("category"),
            "post_count": parse_post_count(payload.title_data.get("post_count")),
            "summary": payload.summary_text,
            "first_seen_at": parse_relative_time(
                payload.title_data.get("time_ago"), payload.scraped_at
            ),
            "last_seen_at": payload.scraped_at,
            "scraped_at": payload.scraped_at,
        }

        db_topic = crud.upsert_trending_topic(session=session, topic_data=db_topic_data)

        db_tweets_data = []
        for conv in payload.conversations:
            metrics = parse_engagement_metrics(conv["raw"])
            db_tweets_data.append(
                {
                    "author_handle": conv["author"],
                    "text": conv["text"],
                    "replies": metrics["replies"],
                    "retweets": metrics["retweets"],
                    "likes": metrics["likes"],
                    "views": metrics["views"],
                }
            )

        crud.replace_trending_tweets(
            session=session,
            topic_id=db_topic.id,
            tweets_data=db_tweets_data,
        )
        logger.info(f"💾 Saved topic '{db_topic.topic_title}' to DB.")


def _resolve_target_user(user_id: str | None) -> Any:
    """Resolve the user ID from database for scoping scraped topics."""
    with Session(engine) as session:
        if user_id:
            try:
                user = session.get(User, uuid.UUID(user_id))
            except Exception:
                user = session.exec(select(User).where(User.email == user_id)).first()
        else:
            user = session.exec(
                select(User).where(User.email == settings.FIRST_SUPERUSER)
            ).first()
            if not user:
                user = session.exec(select(User)).first()

        if user:
            return user.id
        logger.warning("No user found. DB save will be skipped.")
        return None


async def _extract_candidate_summary(
    page: Any, summary_selectors: list[str]
) -> str | None:
    """Extract Grok or event summary from a topic page."""
    summary_text = await extract_grok_summary(page)
    if summary_text:
        return summary_text

    for sel in summary_selectors:
        try:
            summary_locator = page.locator(sel).first
            if await summary_locator.count() > 0:
                candidate = await summary_locator.inner_text()
                if candidate and len(candidate.strip()) > 30:
                    return candidate.strip()
        except Exception:
            continue
    return None


async def _navigate_and_verify_topic(
    page: Any,
    mouse: EvasionMouse,
    target_id: str,
    is_href: bool,
    tweet_selector: str,
) -> tuple[bool, TopicFailure | None]:
    """Click a topic link and verify the resulting page state."""
    selector = f'a[href="{target_id}"]' if is_href else f'[data-testid="{target_id}"]'
    link_locator = page.locator(selector).first

    if is_href:
        try:
            await link_locator.evaluate("node => node.removeAttribute('target')")
        except Exception as e:
            logger.debug(f"Could not remove target attribute: {e}")

    await mouse.human_click(selector=selector)
    logger.info("Navigated to topic page. Waiting for content...")

    try:
        await page.wait_for_selector(tweet_selector, state="visible", timeout=15000)
    except PlaywrightError:
        logger.warning(f"Timeout waiting for tweets on {target_id}. Skipping.")
        failure = TopicFailure(
            topic_id=target_id,
            reason="timeout",
            detail="Timed out waiting for tweet selector after 15s.",
        )
        return False, failure

    topic_page_state = await detect_page_state(page)
    if topic_page_state != "ok":
        failure = TopicFailure(
            topic_id=target_id,
            reason="page_state_error",
            detail=f"detect_page_state returned: {topic_page_state}",
        )
        return False, failure

    return True, None


async def _process_single_topic(
    page: Any,
    mouse: EvasionMouse,
    target_id: str,
    target_title: str,
    is_href: bool,
    db_user_id: Any,
    config: dict[str, Any],
) -> tuple[bool, TopicFailure | None]:
    """Process a single topic navigation, scraping, and database persistence."""
    logger.info(f"Targeting topic: {target_id}")
    await random_delay(min_sec=1.0, max_sec=3.0)

    selectors = config.get("selectors", {})
    tweet_selector = selectors.get("tweet_container", "[data-testid='tweet']")
    summary_selectors = selectors.get(
        "summary_selectors",
        [
            "[data-testid='grok-summary']",
            "[data-testid='eventSummary']",
            "div[data-testid='cellInnerDiv']",
        ],
    )
    scrolls_per_topic = config.get("scrolls_per_topic", 2)

    ok, failure = await _navigate_and_verify_topic(
        page, mouse, target_id, is_href, tweet_selector
    )
    if not ok:
        await page.goto("https://x.com/home", wait_until="domcontentloaded")
        await random_delay(min_sec=3.0, max_sec=5.0)
        return False, failure

    await random_delay(min_sec=2.0, max_sec=5.0)
    summary_text = await _extract_candidate_summary(page, summary_selectors)
    conversations = await _scrape_topic_tweets(
        page, mouse, tweet_selector, scrolls_per_topic
    )
    title_data = parse_title_metadata(target_title)
    scraped_at = datetime.now(timezone.utc)

    db_failure = None
    try:
        _save_topic_record(
            TopicRecordPayload(
                db_user_id=db_user_id,
                topic_url=page.url,
                title_data=title_data,
                summary_text=summary_text,
                conversations=conversations,
                scraped_at=scraped_at,
            )
        )
    except Exception as e:
        logger.error(f"DB save error: {e}")
        db_failure = TopicFailure(
            topic_id=target_id,
            reason="db_error",
            detail=str(e),
        )

    await page.goto("https://x.com/home", wait_until="domcontentloaded")
    min_delay = config.get("min_delay_between_topics", 4.0)
    max_delay = config.get("max_delay_between_topics", 7.0)
    delay = random.uniform(min_delay, max_delay)
    await random_delay(min_sec=delay, max_sec=delay)

    if len(conversations) == 0:
        return True, TopicFailure(
            topic_id=target_id,
            reason="no_tweets",
            detail="Page loaded but no tweets could be extracted.",
        )

    return True, db_failure


async def scrape_trending_topics(
    *,
    user_id: str | None = None,
    max_topics: int | None = None,
    headless: bool | None = None,
) -> ScrapeResult:
    """Scrape trending news topics from X.com."""
    if headless is not None:
        os.environ["PLAYWRIGHT_HEADLESS"] = "1" if headless else "0"
    elif "PLAYWRIGHT_HEADLESS" not in os.environ:
        os.environ["PLAYWRIGHT_HEADLESS"] = "0"

    db_user_id = _resolve_target_user(user_id)

    config_path = Path(__file__).parent.parent / "scrape_config.json"
    with open(config_path) as f:
        config = json.load(f)

    if max_topics is None:
        max_topics = config.get("max_topics_to_scrape", 3)

    selectors = config.get("selectors", {})
    sidebar_selector = selectors.get(
        "sidebar_container", "[data-testid='sidebarColumn']"
    )
    sidebar_link_selector = selectors.get("sidebar_link", "a[role='link']")
    heuristic = config.get("link_heuristic", {})

    result = ScrapeResult(status="error")
    manager = BrowserManager(user_id=str(db_user_id) if db_user_id else "default")

    try:
        logger.info("Connecting to X.com...")
        async with manager.get_context(
            "x", headless=(os.environ["PLAYWRIGHT_HEADLESS"] == "1")
        ) as context:
            page = (
                context.pages[0] if len(context.pages) > 0 else await context.new_page()
            )
            for p in context.pages[1:]:
                await p.close()

            mouse = EvasionMouse(page)
            asyncio.create_task(mouse.start_idle())

            logger.info("Navigating to https://x.com/home")
            await page.goto("https://x.com/home", wait_until="domcontentloaded")
            await random_delay(min_sec=4.0, max_sec=6.0)

            page_state = await detect_page_state(page)
            if page_state != "ok":
                logger.error(f"Page state check failed: {page_state}")
                await mouse.stop_idle()
                result.status = (
                    "auth_failed" if page_state == "logged_out" else page_state
                )
                result.errors.append(f"Initial page state: {page_state}")
                return result

            sidebar = page.locator(sidebar_selector)
            news_urls, news_titles = await _extract_sidebar_links(
                sidebar, sidebar_link_selector, heuristic
            )

            if not news_urls:
                logger.warning("No news links matched the heuristic.")
                await mouse.stop_idle()
                result.status = "no_topics"
                result.errors.append("No sidebar news links matched heuristic.")
                return result

            result.topics_found = len(news_urls)
            targets = news_urls[:max_topics]
            random.shuffle(targets)

            for target_id, is_href in targets:
                target_title = news_titles[target_id]
                scraped, failure = await _process_single_topic(
                    page=page,
                    mouse=mouse,
                    target_id=target_id,
                    target_title=target_title,
                    is_href=is_href,
                    db_user_id=db_user_id,
                    config=config,
                )
                if scraped:
                    result.topics_scraped += 1
                if failure:
                    result.topics_failed.append(failure)

            await mouse.stop_idle()

            if result.topics_scraped == 0:
                result.status = "error"
                result.errors.append("No topics were successfully scraped.")
            elif result.topics_failed:
                result.status = "partial"
            else:
                result.status = "success"

            logger.info(
                f"Scraping completed: {result.status} "
                f"({result.topics_scraped}/{result.topics_found} topics)"
            )

    except PlaywrightError as e:
        if "closed" in str(e).lower():
            logger.error(
                "❌ ABORT: User manually closed the browser window. Halting execution."
            )
            result.status = "aborted"
            result.errors.append("Browser window was closed during scraping.")
        else:
            logger.error(f"Playwright error: {e}")
            result.status = "error"
            result.errors.append(f"PlaywrightError: {e}")
    except Exception as e:
        logger.error(f"Error during scraping: {e}")
        result.status = "error"
        result.errors.append(f"Unexpected error: {e}")

    return result


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


async def main() -> None:
    """CLI wrapper that prints the structured result as JSON."""
    result = await scrape_trending_topics()

    # Print structured result for debugging / piping
    print("\n" + "=" * 60)  # noqa: T201
    print("SCRAPE RESULT:")  # noqa: T201
    print(  # noqa: T201
        json.dumps(
            {
                "status": result.status,
                "topics_found": result.topics_found,
                "topics_scraped": result.topics_scraped,
                "topics_failed": [
                    {"topic_id": f.topic_id, "reason": f.reason, "detail": f.detail}
                    for f in result.topics_failed
                ],
                "errors": result.errors,
            },
            indent=2,
        )
    )
    print("=" * 60)  # noqa: T201


if __name__ == "__main__":
    asyncio.run(main())
