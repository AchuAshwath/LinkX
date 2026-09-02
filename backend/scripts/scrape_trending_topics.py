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
import sys
import urllib.parse
import uuid
from datetime import datetime, timezone
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
from app.services.browser.actions import EvasionMouse, random_delay
from app.services.browser.diagnostics import detect_page_state, extract_grok_summary
from app.services.browser.manager import BrowserManager
from app.services.browser.tools import find_or_heal_element
from scripts.scrape_models import (
    CandidateScrapeContext,
    ScrapeResult,
    TopicFailure,
    TopicProcessContext,
    TopicRecordPayload,
)
from scripts.scrape_parsers import (
    _clean_category,
    _expand_tweet,
    extract_tweet_data,
    parse_engagement_metrics,
    parse_post_count,
    parse_relative_time,
    parse_title_metadata,
)

logging.basicConfig(level=logging.DEBUG, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

MAX_TWEETS_PER_AUTHOR = 2

__all__ = [
    "CandidateScrapeContext",
    "MAX_TWEETS_PER_AUTHOR",
    "ScrapeResult",
    "TopicFailure",
    "TopicProcessContext",
    "TopicRecordPayload",
    "_clean_category",
    "_expand_tweet",
    "extract_topic_tweets",
    "extract_trending_sidebar",
    "extract_tweet_data",
    "navigate_to_trends",
    "parse_engagement_metrics",
    "parse_post_count",
    "parse_relative_time",
    "parse_title_metadata",
    "scrape_trending_topics",
]


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
    if not text or len(text.strip()) < 2:
        return False
    if heuristic.get("must_contain_newline", False) and "\n" not in text:
        return False
    prefix = heuristic.get("exclude_prefix", "@")
    if prefix and text.strip().startswith(prefix):
        return False
    exclude_texts = heuristic.get("exclude_texts", ["Show more", "Subscribe"])
    return not any(ex.lower() in text.lower() for ex in exclude_texts)


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


async def _resolve_link_href(link: Any, *, clean_title: str) -> str:
    """Resolve href attribute or construct search query URL."""
    url = await link.get_attribute("href")
    if not url:
        try:
            nested_a = link.locator("a[href*='/search?q=']").first
            if await nested_a.count() > 0:
                url = await nested_a.get_attribute("href")
        except Exception:
            pass
    if not url:
        url = f"/search?q={urllib.parse.quote(clean_title)}"
    return str(url)


async def _parse_and_validate_link(
    link: Any,
    heuristic: dict[str, Any],
    seen_titles: set[str],
) -> tuple[str, str, str] | None:
    """Extract and validate link title and URL, returning (url, raw_text, clean_title)."""
    try:
        text = await link.inner_text()
        if not text or len(text.strip()) < 2:
            return None
        meta = parse_title_metadata(text)
        clean_title = meta.get("topic_title") or text.split("\n")[0].strip()
        if not clean_title or clean_title in seen_titles:
            return None
        if not _is_valid_topic_text(text, heuristic):
            return None
        url = await _resolve_link_href(link, clean_title=clean_title)
        return url, text, clean_title
    except Exception:
        return None


async def _extract_sidebar_links(
    sidebar: Any,
    link_selector: str,
    heuristic: dict[str, Any],
) -> tuple[list[tuple[str, bool]], dict[str, str]]:
    """Extract valid sidebar news links according to heuristics."""
    all_links = await sidebar.locator(link_selector).all()
    news_urls: list[tuple[str, bool]] = []
    news_titles: dict[str, str] = {}
    seen_titles: set[str] = set()

    for link in all_links:
        parsed = await _parse_and_validate_link(link, heuristic, seen_titles)
        if parsed is None:
            continue
        url, text, clean_title = parsed
        seen_titles.add(clean_title)
        news_urls.append((url, True))
        news_titles[url] = text

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


async def _execute_topic_click_or_goto(
    ctx: TopicProcessContext,
    selector: str,
    clean_text: str,
) -> None:
    """Attempt stealth click on topic element with fallback to direct search navigation."""
    try:
        if ctx.is_href:
            link_locator = ctx.page.locator(selector).first
            try:
                await link_locator.evaluate("node => node.removeAttribute('target')")
            except Exception:
                pass
        await ctx.mouse.human_click(selector=selector)
    except Exception as click_err:
        logger.debug(f"Direct click failed on {selector}: {click_err}")
        search_query = urllib.parse.quote(clean_text)
        direct_url = f"https://x.com/search?q={search_query}"
        try:
            await ctx.page.goto(direct_url, wait_until="domcontentloaded")
        except Exception as goto_err:
            logger.warning(f"Fallback navigation to {direct_url} failed: {goto_err}")


async def _navigate_and_verify_topic(
    ctx: TopicProcessContext,
    tweet_selector: str,
) -> tuple[bool, TopicFailure | None]:
    """Click a topic link and verify the resulting page state."""
    clean_text = ctx.target_title.split("\n")[0].strip()
    if ctx.is_href:
        selector = f'a[href="{ctx.target_id}"]'
    else:
        selector = f'[data-testid="trend"]:has-text({json.dumps(clean_text)})'

    await _execute_topic_click_or_goto(ctx, selector, clean_text)

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
    page: Any, *, target_url: str = "https://x.com/explore"
) -> bool:
    """Navigate to X.com explore/trends and verify authenticated page state."""
    state = await detect_page_state(page)
    if state in {"logged_out", "rate_limited", "captcha"}:
        return False
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


async def _wait_for_trends_dom(page: Any) -> None:
    """Wait for trend elements to appear in the DOM."""
    try:
        if hasattr(page, "locator"):
            await page.locator("[data-testid='trend']").first.wait_for(
                state="visible", timeout=10000
            )
    except Exception as e:
        logger.debug(f"Wait for trend element timed out or skipped: {e}")


async def _resolve_sidebar_container(
    page: Any,
    selectors: dict[str, Any],
    config_path: str | Path | None,
) -> Any:
    """Find or self-heal sidebar container element, fallback to page."""
    cfg_path = config_path or (
        Path(__file__).parent.parent / "app/services/browser/selectors/x_selectors.json"
    )
    try:
        sidebar = await find_or_heal_element(
            page=page,
            selector_key="selectors.sidebar_container",
            selectors_dict=selectors,
            config_path=cfg_path,
        )
        if sidebar is not None:
            return sidebar
    except Exception as e:
        logger.debug(f"Sidebar lookup failed, searching page directly: {e}")
    return page


async def extract_trending_sidebar(
    page: Any,
    *,
    selectors: dict[str, Any],
    config_path: str | Path | None = None,
) -> list[TrendingTopic]:
    """Extract structured TrendingTopic models from the X.com sidebar."""
    sidebar_link_sel = (
        selectors.get("selectors", {}).get("sidebar_link")
        or selectors.get("feed", {}).get("news_trends")
        or "[data-testid='trend'], a[href*='/search?q='], [data-testid^='news_sidebar_article']"
    )
    heuristic = selectors.get("link_heuristic", {"must_contain_newline": False})

    await _wait_for_trends_dom(page)
    container = await _resolve_sidebar_container(page, selectors, config_path)
    news_urls, news_titles = await _extract_sidebar_links(
        container, sidebar_link_sel, heuristic
    )

    if not news_urls and container is not page:
        news_urls, news_titles = await _extract_sidebar_links(
            page, sidebar_link_sel, heuristic
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
            category=_clean_category(meta.get("category")),
            post_count=parse_post_count(meta.get("post_count")),
            scraped_at=now,
        )
        topics.append(topic)

    return topics


async def _navigate_to_topic_url(page: Any, topic_url: str) -> None:
    """Navigate to topic URL if page is not already on it."""
    page_url = getattr(page, "url", None)
    if page_url != topic_url and hasattr(page, "goto"):
        await page.goto(topic_url, wait_until="domcontentloaded")


async def _wait_for_tweets_dom(page: Any, tweet_sel: str) -> None:
    """Wait for tweets to appear in the DOM."""
    try:
        if hasattr(page, "locator"):
            await page.locator(tweet_sel).first.wait_for(state="visible", timeout=6000)
    except Exception:
        pass


async def extract_topic_tweets(
    page: Any,
    *,
    topic_url: str,
    selectors: dict[str, Any],
) -> list[TrendingTweet]:
    """Extract structured TrendingTweet models from a specific topic URL."""
    await _navigate_to_topic_url(page, topic_url)
    tweet_sel = selectors.get("selectors", {}).get(
        "tweet_container", "[data-testid='tweet']"
    )
    await _wait_for_tweets_dom(page, tweet_sel)

    # Evaluate tweets on page
    raw_tweets = await page.evaluate(
        """(selector) => {
            const tweetElements = document.querySelectorAll(selector);
            const results = [];
            for (const el of tweetElements) {
                const textEl = el.querySelector('[data-testid="tweetText"]');
                const text = textEl ? textEl.innerText : el.innerText;
                const authorEl = el.querySelector('[data-testid="User-Name"]');
                const author = authorEl ? authorEl.innerText.split('\\n')[0] : "unknown";
                results.push({
                    author_handle: author,
                    text: text,
                    replies: 0,
                    retweets: 0,
                    likes: 0,
                    views: 0
                });
            }
            return results;
        }""",
        tweet_sel,
    )

    tweets: list[TrendingTweet] = []
    dummy_topic_id = uuid.uuid4()

    if isinstance(raw_tweets, list):
        for raw in raw_tweets:
            tweet = TrendingTweet(
                id=uuid.uuid4(),
                topic_id=dummy_topic_id,
                author_handle=raw.get("author_handle", "unknown"),
                text=raw.get("text", ""),
                replies=raw.get("replies"),
                retweets=raw.get("retweets"),
                likes=raw.get("likes"),
                views=raw.get("views"),
            )
            tweets.append(tweet)

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
