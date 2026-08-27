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
from app.models import TrendingTopic, TrendingTweet, User
from app.services.browser.actions import EvasionMouse, human_navigation, random_delay
from app.services.browser.diagnostics import detect_page_state, extract_grok_summary
from app.services.browser.manager import BrowserManager
from app.services.browser.tools import find_or_heal_element

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
    except Exception:
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


def _parse_prefixed_topic(
    parts: list[str],
) -> tuple[str, str | None, str | None, list[str]]:
    """Parse topic blocks where first line contains category or trending marker."""
    category = parts[0]
    clean_title = parts[1]
    post_count = parts[2] if len(parts) >= 3 else None
    extra_lines = parts[3:] if len(parts) >= 4 else []
    return clean_title, category, post_count, extra_lines


def _parse_dot_separated_topic(
    parts: list[str],
) -> tuple[str, str | None, str | None, str | None, list[str]]:
    """Parse topic blocks where second line contains dot-separated metadata."""
    clean_title = parts[0]
    meta_parts = [p.strip() for p in parts[1].split("·")]
    time_ago = meta_parts[0] if len(meta_parts) >= 1 and meta_parts[0] else None
    category = meta_parts[1] if len(meta_parts) >= 2 and meta_parts[1] else None
    post_count = meta_parts[2] if len(meta_parts) >= 3 and meta_parts[2] else None
    extra_lines = parts[2:]
    return clean_title, category, post_count, time_ago, extra_lines


def _is_prefixed_topic_header(header: str) -> bool:
    """Check if header line represents a category prefix or trending marker."""
    return "·" in header or "trending" in header.lower()


def parse_title_metadata(raw_title: str) -> dict[str, Any]:
    """Parse the raw sidebar title block into structured fields."""
    parts = [p.strip() for p in raw_title.split("\n") if p.strip()]
    if not parts:
        return {"topic_title": raw_title, "raw_title_block": raw_title}

    time_ago: str | None = None
    category: str | None = None
    post_count: str | None = None
    clean_title: str = parts[0]
    extra_lines: list[str] = []

    if len(parts) >= 2:
        if _is_prefixed_topic_header(parts[0]):
            clean_title, category, post_count, extra_lines = _parse_prefixed_topic(
                parts
            )
        else:
            clean_title, category, post_count, time_ago, extra_lines = (
                _parse_dot_separated_topic(parts)
            )

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

    for i, link in enumerate(all_links):
        try:
            text = await link.inner_text()
            if not text or not text.strip():
                continue
            url = await link.get_attribute("href")
            first_line = text.split("\n")[0].strip()
            identifier = url or (first_line if first_line else f"trend_{i}")

            if _should_skip_link(identifier, text, news_titles, heuristic):
                continue

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


def _save_topic_safely(
    ctx: TopicProcessContext,
    title_data: dict[str, Any],
    summary_text: str | None,
    conversations: list[dict[str, Any]],
) -> None:
    """Safely persist topic record and associated tweets to PostgreSQL."""
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


async def _delay_between_topics(config: dict[str, Any]) -> None:
    """Introduce humanized jitter delay between topic scrapes."""
    min_d = config.get("min_delay_between_topics", 4.0)
    max_d = config.get("max_delay_between_topics", 7.0)
    delay = random.uniform(min_d, max_d)
    await random_delay(min_sec=delay, max_sec=delay)


async def _process_single_topic(
    ctx: TopicProcessContext,
) -> tuple[bool, TopicFailure | None]:
    """Process a single topic link: navigate, scrape tweets, and persist to DB."""
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

    _save_topic_safely(ctx, title_data, summary_text, conversations)

    await ctx.page.goto("https://x.com/home", wait_until="domcontentloaded")
    await _delay_between_topics(ctx.config)

    if len(conversations) == 0:
        return True, TopicFailure(
            topic_id=ctx.target_id,
            reason="no_tweets",
            detail="No tweets extracted.",
        )

    return True, None


def _should_abort_candidate_loop(failure: TopicFailure | None) -> bool:
    """Check if topic failure represents an unrecoverable browser/account page state."""
    if not failure or failure.reason != "page_state_error":
        return False
    detail = str(failure.detail)
    return any(st in detail for st in ("logged_out", "rate_limited", "captcha"))


async def _handle_candidate_topic(
    ctx: CandidateScrapeContext, target_id: str, is_href: bool
) -> bool:
    """Process a single candidate topic and update scrape results. Returns True if loop should abort."""
    proc_ctx = TopicProcessContext(
        page=ctx.page,
        mouse=ctx.mouse,
        target_id=target_id,
        target_title=ctx.news_titles[target_id],
        is_href=is_href,
        db_user_id=ctx.db_user_id,
        config=ctx.config,
    )
    scraped, failure = await _process_single_topic(proc_ctx)
    if scraped:
        ctx.result.topics_scraped += 1
    if failure:
        ctx.result.topics_failed.append(failure)
        if _should_abort_candidate_loop(failure):
            logger.warning(f"Aborting candidate loop early: {failure.detail}")
            return True
    return False


async def _scrape_candidate_topics(ctx: CandidateScrapeContext) -> None:
    """Iterate through candidate topic URLs until max_topics are successfully scraped."""
    for target_id, is_href in ctx.news_urls:
        if ctx.result.topics_scraped >= ctx.max_topics:
            break
        should_abort = await _handle_candidate_topic(ctx, target_id, is_href)
        if should_abort:
            break


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
            result.status = "completed" if result.topics_scraped > 0 else "no_topics"

    except PlaywrightError as e:
        result.status = "aborted" if "closed" in str(e).lower() else "error"
        result.errors.append(str(e))
    except Exception as e:
        result.status = "error"
        result.errors.append(str(e))

    return result


async def navigate_to_trends(
    page: Any, *, target_url: str = "https://x.com/explore/tabs/trend"
) -> bool:
    """Navigate to X.com trends/explore and verify authenticated page state."""
    state = await detect_page_state(page)
    if state in {"logged_out", "rate_limited", "captcha"}:
        return False
    try:
        await human_navigation(page=page, url=target_url)
    except Exception:
        await page.goto(target_url, wait_until="domcontentloaded")
    post_state = await detect_page_state(page)
    return post_state not in {"logged_out", "rate_limited", "captcha"}


def _format_trend_url(identifier: str, *, is_url: bool, topic_title: str) -> str:
    """Format full topic URL from identifier or topic title."""
    if is_url:
        return (
            identifier
            if identifier.startswith("http")
            else f"https://x.com{identifier}"
        )
    import urllib.parse

    return f"https://x.com/search?q={urllib.parse.quote(topic_title)}"


async def extract_trending_sidebar(
    page: Any,
    *,
    selectors: dict[str, Any],
    config_path: str | Path | None = None,
) -> list[TrendingTopic]:
    """Extract structured TrendingTopic models from the X.com sidebar."""
    cfg_path = config_path or (Path(__file__).parent.parent / "scrape_config.json")
    sidebar_link_sel = selectors.get("selectors", {}).get(
        "sidebar_link", "a[href*='/search?q=']"
    )
    heuristic = selectors.get("link_heuristic", {})

    sidebar = await find_or_heal_element(
        page=page,
        selector_key="selectors.sidebar_container",
        selectors_dict=selectors,
        config_path=cfg_path,
    )

    news_urls, news_titles = await _extract_sidebar_links(
        sidebar, sidebar_link_sel, heuristic
    )

    topics: list[TrendingTopic] = []
    dummy_user_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    for identifier, is_url in news_urls:
        raw_title = news_titles.get(identifier, "")
        meta = parse_title_metadata(raw_title)
        topic_title = meta.get("topic_title") or raw_title
        full_url = _format_trend_url(identifier, is_url=is_url, topic_title=topic_title)

        topic = TrendingTopic(
            id=uuid.uuid4(),
            user_id=dummy_user_id,
            topic_url=full_url,
            topic_title=topic_title,
            category=meta.get("category"),
            post_count=parse_post_count(meta.get("post_count")),
            scraped_at=now,
        )
        topics.append(topic)

    return topics


TWEET_METRICS_EXTRACT_JS = """(selector) => {
    function parseNum(str) {
        if (!str) return 0;
        const match = str.match(/(\\d[\\d,\\.]*\\s*[kKmM]?)/);
        if (!match) return 0;
        const clean = match[1].toLowerCase().replace(/,/g, '').trim();
        if (clean.includes('k')) return Math.round(parseFloat(clean.replace('k', '')) * 1000);
        if (clean.includes('m')) return Math.round(parseFloat(clean.replace('m', '')) * 1000000);
        const parsed = parseInt(clean, 10);
        return isNaN(parsed) ? 0 : parsed;
    }

    const tweetElements = document.querySelectorAll(selector);
    const results = [];
    for (const el of tweetElements) {
        const textEl = el.querySelector('[data-testid="tweetText"]');
        const text = textEl ? textEl.innerText : el.innerText;
        if (!text || text.trim().length === 0) continue;

        const authorEl = el.querySelector('[data-testid="User-Name"]');
        let author = "unknown";
        if (authorEl) {
            const lines = authorEl.innerText.split('\\n');
            const handleLine = lines.find(l => l.startsWith('@'));
            author = handleLine || lines[0] || "unknown";
        }

        const replyBtn = el.querySelector('[data-testid="reply"]');
        const retweetBtn = el.querySelector('[data-testid="retweet"]');
        const likeBtn = el.querySelector('[data-testid="like"]');
        const viewLink = el.querySelector('a[href*="/analytics"]') || el.querySelector('[data-testid="app-text-transition-container"]');

        const replies = parseNum(replyBtn ? replyBtn.innerText || replyBtn.getAttribute('aria-label') : '0');
        const retweets = parseNum(retweetBtn ? retweetBtn.innerText || retweetBtn.getAttribute('aria-label') : '0');
        const likes = parseNum(likeBtn ? likeBtn.innerText || likeBtn.getAttribute('aria-label') : '0');
        const views = parseNum(viewLink ? viewLink.innerText || viewLink.getAttribute('aria-label') : '0');

        results.push({
            author_handle: author,
            text: text,
            replies: replies,
            retweets: retweets,
            likes: likes,
            views: views,
        });
    }
    return results;
}"""


def _parse_evaluated_raw_tweets(
    *, raw_list: Any, dummy_topic_id: uuid.UUID, seen_sigs: set[tuple[str, str]]
) -> list[TrendingTweet]:
    """Parse raw JS-evaluated tweet dictionaries into TrendingTweet models."""
    parsed: list[TrendingTweet] = []
    if not isinstance(raw_list, list):
        return parsed
    for raw in raw_list:
        if not isinstance(raw, dict):
            continue
        handle = str(raw.get("author_handle", "unknown"))
        txt = str(raw.get("text", ""))
        sig = (handle, txt)
        if sig in seen_sigs:
            continue
        seen_sigs.add(sig)
        parsed.append(
            TrendingTweet(
                id=uuid.uuid4(),
                topic_id=dummy_topic_id,
                author_handle=handle,
                text=txt,
                replies=raw.get("replies"),
                retweets=raw.get("retweets"),
                likes=raw.get("likes"),
                views=raw.get("views"),
            )
        )
    return parsed


async def extract_topic_tweets(
    page: Any,
    *,
    topic_url: str,
    selectors: dict[str, Any],
) -> list[TrendingTweet]:
    """Extract structured TrendingTweet models from a specific topic URL."""
    if hasattr(page, "url") and page.url != topic_url and hasattr(page, "goto"):
        try:
            await human_navigation(page=page, url=topic_url)
        except Exception:
            await page.goto(topic_url, wait_until="domcontentloaded")

    tweet_sel = selectors.get("selectors", {}).get(
        "tweet_container", "[data-testid='tweet']"
    )

    try:
        if hasattr(page, "wait_for_selector"):
            await page.wait_for_selector(tweet_sel, timeout=4000)
    except Exception:
        pass

    await random_delay(min_sec=0.5, max_sec=1.5)

    raw_tweets = await page.evaluate(TWEET_METRICS_EXTRACT_JS, tweet_sel)
    dummy_topic_id = uuid.uuid4()
    seen_sigs: set[tuple[str, str]] = set()

    tweets = _parse_evaluated_raw_tweets(
        raw_list=raw_tweets,
        dummy_topic_id=dummy_topic_id,
        seen_sigs=seen_sigs,
    )

    if len(tweets) < 5 and hasattr(page, "mouse") and hasattr(page.mouse, "wheel"):
        try:
            await page.mouse.wheel(delta_x=0, delta_y=700)
            await random_delay(min_sec=1.0, max_sec=2.0)
            more_raw = await page.evaluate(TWEET_METRICS_EXTRACT_JS, tweet_sel)
            tweets.extend(
                _parse_evaluated_raw_tweets(
                    raw_list=more_raw,
                    dummy_topic_id=dummy_topic_id,
                    seen_sigs=seen_sigs,
                )
            )
        except Exception:
            pass

    return tweets


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
