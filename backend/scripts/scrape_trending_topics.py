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
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

# Add backend to path so we can run from anywhere
sys.path.append(str(Path(__file__).parent.parent))

from rebrowser_playwright.async_api import Error as PlaywrightError

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
    files_written: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Tweet extraction
# ---------------------------------------------------------------------------

MAX_TWEETS_PER_AUTHOR = 2


async def extract_tweet_data(locator) -> dict | None:
    """Parse author, text, and raw content from a tweet locator.

    Catches only Playwright errors (stale elements, closed pages).
    Raises unexpected exceptions so bugs are not silently swallowed.
    """
    try:
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


async def scrape_trending_topics() -> ScrapeResult:
    """Scrape trending news topics from X.com.

    Returns a structured ScrapeResult so a LangGraph agent can
    branch on status without parsing log output.
    """
    # Force headed mode so developer can watch
    if "PLAYWRIGHT_HEADLESS" not in os.environ:
        os.environ["PLAYWRIGHT_HEADLESS"] = "0"

    # Load config
    config_path = Path(__file__).parent.parent / "scrape_config.json"
    with open(config_path) as f:
        config = json.load(f)

    max_topics = config.get("max_topics_to_scrape", 3)
    scrolls_per_topic = config.get("scrolls_per_topic", 2)
    min_delay = config.get("min_delay_between_topics", 4.0)
    max_delay = config.get("max_delay_between_topics", 7.0)

    selectors = config.get("selectors", {})
    sidebar_selector = selectors.get(
        "sidebar_container", "[data-testid='sidebarColumn']"
    )
    sidebar_link_selector = selectors.get("sidebar_link", "a[role='link']")
    tweet_selector = selectors.get("tweet_container", "[data-testid='tweet']")
    summary_selectors = selectors.get(
        "summary_selectors",
        [
            "[data-testid='grok-summary']",
            "[data-testid='eventSummary']",
            "div[data-testid='cellInnerDiv']",
        ],
    )

    heuristic = config.get("link_heuristic", {})
    must_contain_newline = heuristic.get("must_contain_newline", True)
    exclude_texts = heuristic.get("exclude_texts", ["Show more", "Subscribe"])
    exclude_prefix = heuristic.get("exclude_prefix", "@")

    out_dir = Path(config.get("output_directory", "./data/scraped_trends"))
    out_dir.mkdir(parents=True, exist_ok=True)

    result = ScrapeResult(status="error")
    manager = BrowserManager()

    try:
        logger.info("Connecting to X.com...")
        async with manager.get_context(
            "x", headless=(os.environ["PLAYWRIGHT_HEADLESS"] == "1")
        ) as context:
            # Ensure we only have one tab open
            if len(context.pages) > 0:
                page = context.pages[0]
                for p in context.pages[1:]:
                    await p.close()
            else:
                page = await context.new_page()

            mouse = EvasionMouse(page)
            asyncio.create_task(mouse.start_idle())

            logger.info("Navigating to https://x.com/home")
            await page.goto("https://x.com/home", wait_until="domcontentloaded")

            # Wait for feed and sidebar to load
            await random_delay(min_sec=4.0, max_sec=6.0)

            # ── Check page state before proceeding ──────────────
            page_state = await detect_page_state(page)
            if page_state != "ok":
                logger.error(f"Page state check failed: {page_state}")
                await mouse.stop_idle()
                result.status = (
                    "auth_failed" if page_state == "logged_out" else page_state
                )
                result.errors.append(f"Initial page state: {page_state}")
                return result

            # ── Extract sidebar news topics ─────────────────────
            logger.info("Extracting trending topics from the sidebar...")
            sidebar = page.locator(sidebar_selector)
            all_links = await sidebar.locator(sidebar_link_selector).all()

            news_urls: list[tuple[str, bool]] = []
            news_titles: dict[str, str] = {}
            for link in all_links:
                try:
                    text = await link.inner_text()
                    url = await link.get_attribute("href")
                    testid = await link.get_attribute("data-testid")
                    identifier = url if url else testid
                    is_href = bool(url)

                    # Apply heuristic from config
                    is_valid = True
                    if must_contain_newline and "\n" not in text:
                        is_valid = False
                    if exclude_prefix and text.startswith(exclude_prefix):
                        is_valid = False
                    for ex in exclude_texts:
                        if ex in text:
                            is_valid = False

                    if identifier and is_valid and identifier not in news_titles:
                        news_urls.append((identifier, is_href))
                        news_titles[identifier] = text
                except Exception:
                    continue

            if not news_urls:
                logger.warning(
                    "No news links matched the heuristic. "
                    "(They might be out of view or not rendered yet)."
                )
                logger.debug("--- DIAGNOSTIC: Available Links ---")
                for link in all_links:
                    try:
                        logger.debug(
                            f"Href: {await link.get_attribute('href')} "
                            f"| Text: {repr(await link.inner_text())}"
                        )
                    except Exception:
                        pass
                logger.debug("-----------------------------------")
                await mouse.stop_idle()
                result.status = "no_topics"
                result.errors.append(
                    "No sidebar news links matched the configured heuristic."
                )
                return result

            result.topics_found = len(news_urls)
            logger.info(f"Found {len(news_urls)} news topics to scrape.")

            # ── Randomize visit order to avoid fingerprinting ───
            targets = news_urls[:max_topics]
            random.shuffle(targets)

            # ── Scrape each topic ───────────────────────────────
            for target_id, is_href in targets:
                target_title = news_titles[target_id]
                logger.info(f"Targeting topic: {target_id}")

                # Pause before clicking (variable delay)
                await random_delay(min_sec=1.0, max_sec=3.0)

                if is_href:
                    selector = f'a[href="{target_id}"]'
                else:
                    selector = f'[data-testid="{target_id}"]'

                link_locator = page.locator(selector).first

                # Prevent opening in a new tab
                if is_href:
                    try:
                        await link_locator.evaluate(
                            "node => node.removeAttribute('target')"
                        )
                    except Exception as e:
                        logger.debug(f"Could not remove target attribute: {e}")

                # Click with human-like mouse movement
                await mouse.human_click(selector=selector)

                # Wait for the topic page to load
                logger.info("Navigated to topic page. Waiting for content...")
                try:
                    await page.wait_for_selector(
                        tweet_selector, state="visible", timeout=15000
                    )
                except PlaywrightError:
                    logger.warning(
                        f"Timeout waiting for tweets on {target_id}. Skipping."
                    )
                    result.topics_failed.append(
                        TopicFailure(
                            topic_id=target_id,
                            reason="timeout",
                            detail="Timed out waiting for tweet selector after 15s.",
                        )
                    )
                    # Navigate directly instead of go_back (more reliable with SPA)
                    await page.goto("https://x.com/home", wait_until="domcontentloaded")
                    await random_delay(min_sec=3.0, max_sec=5.0)
                    continue

                # ── Check page state after navigation ───────────
                topic_page_state = await detect_page_state(page)
                if topic_page_state != "ok":
                    logger.warning(
                        f"Page state error on topic {target_id}: {topic_page_state}"
                    )
                    result.topics_failed.append(
                        TopicFailure(
                            topic_id=target_id,
                            reason="page_state_error",
                            detail=f"detect_page_state returned: {topic_page_state}",
                        )
                    )
                    await page.goto("https://x.com/home", wait_until="domcontentloaded")
                    await random_delay(min_sec=3.0, max_sec=5.0)
                    continue

                # Simulate initial reading pause (like a human scanning the page)
                await random_delay(min_sec=2.0, max_sec=5.0)

                # ── Extract summary (structural-first JS heuristic) ─
                summary_text = await extract_grok_summary(page)

                # Fallback to config selectors if JS found nothing
                if not summary_text:
                    for sel in summary_selectors:
                        try:
                            summary_locator = page.locator(sel).first
                            if await summary_locator.count() > 0:
                                candidate = await summary_locator.inner_text()
                                if candidate and len(candidate.strip()) > 30:
                                    summary_text = candidate.strip()
                                    break
                        except Exception:
                            continue

                # ── Scrape conversations with reading simulation ─
                conversations: list[dict] = []
                author_counts: dict[str, int] = {}
                remaining_scrolls = scrolls_per_topic  # Fresh copy per topic!
                logger.info("Scraping top 5 tweets...")

                while len(conversations) < 5 and remaining_scrolls >= 0:
                    tweets = await page.locator(tweet_selector).all()
                    for t in tweets:
                        data = await extract_tweet_data(t)
                        if not data:
                            continue

                        # Dedup by raw text
                        if data["raw"] in [c["raw"] for c in conversations]:
                            continue

                        # Cap per-author tweets to ensure diversity
                        author = data["author"]
                        current_count = author_counts.get(author, 0)
                        if current_count >= MAX_TWEETS_PER_AUTHOR:
                            continue

                        conversations.append(data)
                        author_counts[author] = current_count + 1

                        # Simulate reading between tweet extractions
                        await simulate_reading(mouse)

                        if len(conversations) >= 5:
                            break

                    if len(conversations) < 5 and remaining_scrolls > 0:
                        await mouse.human_scroll(scrolls=1)
                        await random_delay(min_sec=1.0, max_sec=3.0)

                    remaining_scrolls -= 1

                # Final safety cap
                conversations = conversations[:5]

                # ── Parse title metadata ────────────────────────
                title_data = parse_title_metadata(target_title)

                # ── Save to disk ────────────────────────────────
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                safe_title = "".join(
                    c if c.isalnum() else "_" for c in title_data["topic_title"]
                )[:30].strip("_")
                filename = f"topic_{safe_title}_{timestamp}.json"

                output_data = {
                    "topic_id": target_id,
                    "topic_url": page.url,
                    **title_data,
                    "summary": summary_text,
                    "scraped_at": datetime.now().isoformat(),
                    "conversations": conversations,
                }

                filepath = out_dir / filename
                with open(filepath, "w") as f:
                    json.dump(output_data, f, indent=2)

                result.files_written.append(str(filepath))
                result.topics_scraped += 1
                logger.info(f"✅ Saved {len(conversations)} tweets to {filename}")

                if len(conversations) == 0:
                    result.topics_failed.append(
                        TopicFailure(
                            topic_id=target_id,
                            reason="no_tweets",
                            detail="Page loaded but no tweets could be extracted.",
                        )
                    )

                # ── Navigate back to homepage (direct, not go_back) ─
                logger.info("Navigating back to homepage...")
                await page.goto("https://x.com/home", wait_until="domcontentloaded")

                # Variable delay between topics
                delay = random.uniform(min_delay, max_delay)
                logger.info(f"Idling for {delay:.1f}s before next topic...")
                await random_delay(min_sec=delay, max_sec=delay)

                # Extra random idle to break pattern (20% chance of longer pause)
                if random.random() < 0.20:
                    extra = random.uniform(3.0, 8.0)
                    logger.debug(f"Extra idle pause: {extra:.1f}s")
                    await random_delay(min_sec=extra, max_sec=extra)

            await mouse.stop_idle()

            # ── Determine final status ──────────────────────────
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
                "files_written": result.files_written,
                "errors": result.errors,
            },
            indent=2,
        )
    )
    print("=" * 60)  # noqa: T201


if __name__ == "__main__":
    asyncio.run(main())
