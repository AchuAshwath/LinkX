"""Scrape trending news topics from X.com sidebar.

This script is designed to be called by a LangGraph orchestration agent.
It returns a structured ScrapeResult dataclass so the agent can branch
on status without parsing log output.
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

MAX_TWEETS_PER_AUTHOR = 2


@dataclass
class TopicFailure:
    """Records why a single topic failed to scrape."""

    topic_id: str
    reason: str
    detail: str = ""


@dataclass
class ScrapeResult:
    """Structured result from a scrape run."""

    status: str
    topics_found: int = 0
    topics_scraped: int = 0
    topics_failed: list[TopicFailure] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


@dataclass
class TopicRecordPayload:
    """Payload bundle for saving scraped topic records."""

    db_user_id: Any
    topic_url: str
    title_data: dict[str, Any]
    summary_text: str | None
    conversations: list[dict[str, Any]]
    scraped_at: datetime


@dataclass
class TopicProcessContext:
    """Execution context for processing a single topic."""

    page: Any
    mouse: EvasionMouse
    target_id: str
    target_title: str
    is_href: bool
    db_user_id: Any
    config: dict[str, Any]


@dataclass
class CandidateScrapeContext:
    """Execution context for iterating candidate topics."""

    page: Any
    mouse: EvasionMouse
    news_urls: list[tuple[str, bool]]
    news_titles: dict[str, str]
    db_user_id: Any
    config: dict[str, Any]
    max_topics: int
    result: ScrapeResult


async def _expand_tweet(locator) -> None:
    """Click the 'Show more' link inside a tweet article if present."""
    try:
        show_more = locator.locator('[data-testid="tweet-text-show-more-link"]')
        if await show_more.count() > 0:
            await show_more.first.click(timeout=3000)
            await locator.page.wait_for_timeout(400)
            return
        fallback = locator.locator("span").filter(has_text="Show more")
        if await fallback.count() > 0:
            await fallback.first.click(timeout=3000)
            await locator.page.wait_for_timeout(400)
    except PlaywrightError:
        pass


async def extract_tweet_data(locator) -> dict | None:
    """Parse author, full text, and raw content from a tweet article locator."""
    try:
        await _expand_tweet(locator)
        text_element = locator.locator('[data-testid="tweetText"]').first
        text = await text_element.inner_text() if await text_element.count() > 0 else ""
        full_text = await locator.inner_text()

        lines = [line.strip() for line in full_text.split("\n") if line.strip()]
        author = next((line for line in lines if line.startswith("@")), "Unknown")

        return {"author": author, "text": text or full_text, "raw": full_text}
    except PlaywrightError as e:
        logger.warning(f"Playwright error extracting tweet: {e}")
        return None


def parse_title_metadata(raw_title: str) -> dict:
    """Parse the raw sidebar title block into structured fields."""
    parts = raw_title.split("\n") if "\n" in raw_title else [raw_title]
    clean_title = parts[0].strip()
    time_ago = None
    category = None
    post_count = None
    extra_lines = [p.strip() for p in parts[2:] if p.strip()] if len(parts) > 2 else []

    if len(parts) > 1:
        meta_parts = [p.strip() for p in parts[1].split("·")]
        time_ago = meta_parts[0] if len(meta_parts) >= 1 and meta_parts[0] else None
        category = meta_parts[1] if len(meta_parts) >= 2 and meta_parts[1] else None
        post_count = meta_parts[2] if len(meta_parts) >= 3 and meta_parts[2] else None

    return {
        "topic_title": clean_title,
        "time_ago": time_ago,
        "category": category,
        "post_count": post_count,
        "extra_metadata": extra_lines or None,
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
        if "m" in clean:
            return int(float(clean.replace("m", "")) * 1000000)
        return int(clean)
    except ValueError:
        return None


def parse_relative_time(time_str: str | None, base_time: datetime) -> datetime | None:
    if not time_str:
        return None
    clean = time_str.lower().strip()
    try:
        if "hour" in clean:
            match = re.search(r"(\d+)", clean)
            return base_time - timedelta(hours=int(match.group(1)) if match else 1)
        if "minute" in clean:
            match = re.search(r"(\d+)", clean)
            return base_time - timedelta(minutes=int(match.group(1)) if match else 1)
        if "day" in clean:
            match = re.search(r"(\d+)", clean)
            return base_time - timedelta(days=int(match.group(1)) if match else 1)
        if "yesterday" in clean:
            return base_time - timedelta(days=1)
        return None
    except Exception:
        return None


def parse_engagement_metrics(raw_text: str) -> dict[str, int | None]:
    """Parse engagement metrics from a tweet's raw inner text."""

    def parse_metric(val: str) -> int | None:
        clean = val.lower().replace(",", "").strip()
        try:
            if "k" in clean:
                return int(float(clean.replace("k", "")) * 1000)
            if "m" in clean:
                return int(float(clean.replace("m", "")) * 1000000)
            return int(clean)
        except ValueError:
            return None

    lines = [line.strip() for line in raw_text.split("\n") if line.strip()]
    if len(lines) < 4:
        return {"replies": None, "retweets": None, "likes": None, "views": None}

    return {
        "views": parse_metric(lines[-1]),
        "likes": parse_metric(lines[-2]),
        "retweets": parse_metric(lines[-3]),
        "replies": parse_metric(lines[-4]),
    }


async def simulate_reading(mouse: EvasionMouse) -> None:
    """Randomly pause and scroll to simulate a human reading tweets."""
    rand = random.random()
    if rand < 0.4:
        await random_delay(min_sec=1.5, max_sec=4.0)
    elif rand < 0.65:
        await mouse.human_scroll(scrolls=1)
        await random_delay(min_sec=0.5, max_sec=1.5)
    elif rand < 0.75:
        await random_delay(min_sec=3.0, max_sec=7.0)


def _is_valid_topic_text(text: str, heuristic: dict[str, Any]) -> bool:
    """Validate topic text against heuristics."""
    if heuristic.get("must_contain_newline", True) and "\n" not in text:
        return False
    prefix = heuristic.get("exclude_prefix", "@")
    if prefix and text.startswith(prefix):
        return False
    exclude_texts = heuristic.get("exclude_texts", ["Show more", "Subscribe"])
    return not any(ex in text for ex in exclude_texts)


def _should_skip_link(
    identifier: str | None,
    text: str,
    seen_titles: dict[str, str],
    heuristic: dict[str, Any],
) -> bool:
    """Check if a sidebar link should be skipped."""
    if not identifier:
        return True
    if identifier in seen_titles:
        return True
    return not _is_valid_topic_text(text, heuristic)


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

            if _should_skip_link(identifier, text, news_titles, heuristic):
                continue

            if identifier:
                news_urls.append((identifier, bool(url)))
                news_titles[identifier] = text
        except Exception:
            continue

    return news_urls, news_titles


async def _scrape_topic_tweets(
    ctx: TopicProcessContext,
    tweet_selector: str,
) -> list[dict]:
    """Scrape top tweets with human reading simulation."""
    conversations: list[dict] = []
    author_counts: dict[str, int] = {}
    remaining_scrolls = ctx.config.get("scrolls_per_topic", 2)

    while len(conversations) < 5 and remaining_scrolls >= 0:
        tweets = await ctx.page.locator(tweet_selector).all()
        for t in tweets:
            data = await extract_tweet_data(t)
            if not data or data["raw"] in [c["raw"] for c in conversations]:
                continue

            author = data["author"]
            if author_counts.get(author, 0) >= MAX_TWEETS_PER_AUTHOR:
                continue

            conversations.append(data)
            author_counts[author] = author_counts.get(author, 0) + 1
            await simulate_reading(ctx.mouse)

            if len(conversations) >= 5:
                break

        if len(conversations) < 5 and remaining_scrolls > 0:
            await ctx.mouse.human_scroll(scrolls=1)
            await random_delay(min_sec=1.0, max_sec=3.0)

        remaining_scrolls -= 1

    return conversations[:5]


def _save_topic_record(payload: TopicRecordPayload) -> None:
    """Save scraped topic and tweets to database."""
    if not payload.db_user_id:
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


def _resolve_target_user(user_id: str | None) -> Any:
    """Resolve user ID from DB with clean linear checks."""
    with Session(engine) as session:
        if user_id:
            try:
                user = session.get(User, uuid.UUID(user_id))
                if user:
                    return user.id
            except Exception:
                pass
            by_email = session.exec(select(User).where(User.email == user_id)).first()
            if by_email:
                return by_email.id

        superuser = session.exec(
            select(User).where(User.email == settings.FIRST_SUPERUSER)
        ).first()
        if superuser:
            return superuser.id

        first_user = session.exec(select(User)).first()
        return first_user.id if first_user else None


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
    ctx: TopicProcessContext,
    tweet_selector: str,
) -> tuple[bool, TopicFailure | None]:
    """Click a topic link and verify the resulting page state."""
    selector = (
        f'a[href="{ctx.target_id}"]'
        if ctx.is_href
        else f'[data-testid="{ctx.target_id}"]'
    )
    link_locator = ctx.page.locator(selector).first

    if ctx.is_href:
        try:
            await link_locator.evaluate("node => node.removeAttribute('target')")
        except Exception:
            pass

    await ctx.mouse.human_click(selector=selector)

    try:
        await ctx.page.wait_for_selector(tweet_selector, state="visible", timeout=15000)
    except PlaywrightError:
        return False, TopicFailure(
            topic_id=ctx.target_id,
            reason="timeout",
            detail="Timed out waiting for tweets.",
        )

    topic_page_state = await detect_page_state(ctx.page)
    if topic_page_state != "ok":
        return False, TopicFailure(
            topic_id=ctx.target_id,
            reason="page_state_error",
            detail=f"Page state: {topic_page_state}",
        )

    return True, None


async def _process_single_topic(
    ctx: TopicProcessContext,
) -> tuple[bool, TopicFailure | None]:
    """Process a single topic navigation, scraping, and persistence."""
    logger.info(f"Targeting topic: {ctx.target_id}")
    await random_delay(min_sec=1.0, max_sec=3.0)

    selectors = ctx.config.get("selectors", {})
    tweet_selector = selectors.get("tweet_container", "[data-testid='tweet']")
    summary_selectors = selectors.get("summary_selectors", [])

    ok, failure = await _navigate_and_verify_topic(ctx, tweet_selector)
    if not ok:
        await ctx.page.goto("https://x.com/home", wait_until="domcontentloaded")
        await random_delay(min_sec=3.0, max_sec=5.0)
        return False, failure

    await random_delay(min_sec=2.0, max_sec=5.0)
    summary_text = await _extract_candidate_summary(ctx.page, summary_selectors)
    conversations = await _scrape_topic_tweets(ctx, tweet_selector)
    title_data = parse_title_metadata(ctx.target_title)

    try:
        _save_topic_record(
            TopicRecordPayload(
                db_user_id=ctx.db_user_id,
                topic_url=ctx.page.url,
                title_data=title_data,
                summary_text=summary_text,
                conversations=conversations,
                scraped_at=datetime.now(timezone.utc),
            )
        )
    except Exception as e:
        logger.error(f"DB save error: {e}")

    await ctx.page.goto("https://x.com/home", wait_until="domcontentloaded")
    min_d = ctx.config.get("min_delay_between_topics", 4.0)
    max_d = ctx.config.get("max_delay_between_topics", 7.0)
    delay = random.uniform(min_d, max_d)
    await random_delay(min_sec=delay, max_sec=delay)

    if len(conversations) == 0:
        return True, TopicFailure(
            topic_id=ctx.target_id,
            reason="no_tweets",
            detail="No tweets extracted.",
        )

    return True, None


async def _scrape_candidate_topics(ctx: CandidateScrapeContext) -> None:
    """Iterate through candidate topic URLs until max_topics are successfully scraped."""
    for target_id, is_href in ctx.news_urls:
        if ctx.result.topics_scraped >= ctx.max_topics:
            break

        scraped, failure = await _process_single_topic(
            TopicProcessContext(
                page=ctx.page,
                mouse=ctx.mouse,
                target_id=target_id,
                target_title=ctx.news_titles[target_id],
                is_href=is_href,
                db_user_id=ctx.db_user_id,
                config=ctx.config,
            )
        )
        if scraped:
            ctx.result.topics_scraped += 1
        if failure:
            ctx.result.topics_failed.append(failure)


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

    max_t = max_topics or config.get("max_topics_to_scrape", 3)
    selectors = config.get("selectors", {})
    sidebar_sel = selectors.get("sidebar_container", "[data-testid='sidebarColumn']")
    sidebar_link_sel = selectors.get("sidebar_link", "a[role='link']")
    heuristic = config.get("link_heuristic", {})

    result = ScrapeResult(status="error")
    manager = BrowserManager(user_id=str(db_user_id) if db_user_id else "default")

    try:
        async with manager.get_context(
            "x", headless=(os.environ["PLAYWRIGHT_HEADLESS"] == "1")
        ) as context:
            page = context.pages[0] if context.pages else await context.new_page()
            for p in context.pages[1:]:
                await p.close()

            mouse = EvasionMouse(page)
            asyncio.create_task(mouse.start_idle())

            await page.goto("https://x.com/home", wait_until="domcontentloaded")
            await random_delay(min_sec=4.0, max_sec=6.0)

            page_state = await detect_page_state(page)
            if page_state != "ok":
                await mouse.stop_idle()
                result.status = (
                    "auth_failed" if page_state == "logged_out" else page_state
                )
                return result

            news_urls, news_titles = await _extract_sidebar_links(
                page.locator(sidebar_sel), sidebar_link_sel, heuristic
            )

            if not news_urls:
                await mouse.stop_idle()
                result.status = "no_topics"
                return result

            result.topics_found = len(news_urls)
            await _scrape_candidate_topics(
                CandidateScrapeContext(
                    page=page,
                    mouse=mouse,
                    news_urls=news_urls,
                    news_titles=news_titles,
                    db_user_id=db_user_id,
                    config=config,
                    max_topics=max_t,
                    result=result,
                )
            )

            await mouse.stop_idle()
            result.status = (
                "error"
                if result.topics_scraped == 0
                else ("partial" if result.topics_failed else "success")
            )

    except PlaywrightError as e:
        result.status = "aborted" if "closed" in str(e).lower() else "error"
        result.errors.append(str(e))
    except Exception as e:
        result.status = "error"
        result.errors.append(str(e))

    return result


async def main() -> None:
    """CLI wrapper."""
    result = await scrape_trending_topics()
    print(  # noqa: T201
        json.dumps(
            {
                "status": result.status,
                "topics_found": result.topics_found,
                "topics_scraped": result.topics_scraped,
                "errors": result.errors,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
