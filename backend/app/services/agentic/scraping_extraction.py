"""Explore trends and topic timeline extraction helpers for ScrapingGraph."""

from __future__ import annotations

import inspect
import json
import logging
import random
import urllib.parse
from pathlib import Path
from typing import Any

from app.services.agentic.scraping_persistence import _safe_int
from app.services.browser.actions import human_navigation, random_delay
from app.services.browser.diagnostics import detect_page_state, extract_grok_summary
from scripts.scrape_trending_topics import (
    extract_topic_tweets,
    navigate_to_trends,
)

logger = logging.getLogger(__name__)

SELECTORS_PATH = (
    Path(__file__).parent.parent / "browser" / "selectors" / "x_selectors.json"
)


def _load_selectors() -> dict[str, Any]:
    """Load selectors from JSON configuration with fallback defaults."""
    selectors: dict[str, Any] = {}
    if SELECTORS_PATH.exists():
        try:
            with open(SELECTORS_PATH, encoding="utf-8") as f:
                selectors = json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load x_selectors.json: {e}")
    if "selectors" not in selectors:
        selectors["selectors"] = {
            "sidebar_container": (
                "[data-testid='sidebarColumn'], [data-testid='primaryColumn'], main[role='main']"
            ),
            "sidebar_link": (
                selectors.get("feed", {}).get(
                    "news_trends",
                    "[data-testid='trend'], a[href*='/search?q='], [data-testid^='news_sidebar_article']",
                )
            ),
            "tweet_container": selectors.get("feed", {}).get(
                "timeline_post", "[data-testid='tweet']"
            ),
        }
    return selectors


def _parse_clamped_max_topics(*, val: Any, default: int = 3) -> int:
    """Safely parse and clamp max_topics to [1, 10]."""
    try:
        if val is None:
            return default
        parsed = int(val)
        return max(1, min(10, parsed))
    except (ValueError, TypeError):
        return default


def _format_single_topic(*, topic: Any) -> dict[str, Any] | None:
    """Format and sanitize a single raw topic dictionary or model."""
    if not topic:
        return None
    if isinstance(topic, dict):
        raw_title = topic.get("topic_title") or topic.get("title")
        raw_url = topic.get("topic_url") or topic.get("url")
        category = topic.get("category")
        post_count = topic.get("post_count")
        summary = topic.get("summary")
    else:
        raw_title = getattr(topic, "topic_title", None) or getattr(topic, "title", None)
        raw_url = getattr(topic, "topic_url", None) or getattr(topic, "url", None)
        category = getattr(topic, "category", None)
        post_count = getattr(topic, "post_count", None)
        summary = getattr(topic, "summary", None)

    title = str(raw_title).strip() if raw_title is not None else ""
    url = str(raw_url).strip() if raw_url is not None else ""
    return {
        "topic_title": title,
        "title": title,
        "topic_url": url,
        "url": url,
        "category": str(category) if category is not None else None,
        "post_count": post_count,
        "summary": str(summary) if summary is not None else None,
    }


async def _try_navigate_to_trends(*, page: Any) -> tuple[bool, str]:
    """Attempt navigation to trends and return page state on failure."""
    try:
        nav_ok = await navigate_to_trends(page)
    except Exception as nav_err:
        logger.warning(f"navigate_to_trends raised exception: {nav_err}")
        nav_ok = False

    if nav_ok:
        return True, "ok"

    try:
        page_state = await detect_page_state(page)
    except Exception as state_err:
        logger.debug(f"Failed to detect page state: {state_err}")
        page_state = "error"
    return False, page_state


def _parse_single_tweet(*, tweet: Any) -> dict[str, Any] | None:
    """Parse and sanitize a raw tweet model or dictionary."""
    if not tweet:
        return None
    if isinstance(tweet, dict):
        raw_author = tweet.get("author_handle") or tweet.get("author")
        raw_text = tweet.get("text")
        replies = tweet.get("replies")
        retweets = tweet.get("retweets")
        likes = tweet.get("likes")
        views = tweet.get("views")
    else:
        raw_author = getattr(tweet, "author_handle", None) or getattr(
            tweet, "author", None
        )
        raw_text = getattr(tweet, "text", "")
        replies = getattr(tweet, "replies", None)
        retweets = getattr(tweet, "retweets", None)
        likes = getattr(tweet, "likes", None)
        views = getattr(tweet, "views", None)

    author_handle = str(raw_author).strip() if raw_author else "unknown"
    if not author_handle:
        author_handle = "unknown"
    text_val = str(raw_text) if raw_text is not None else ""

    return {
        "author_handle": author_handle[:255],
        "text": text_val,
        "replies": _safe_int(val=replies),
        "retweets": _safe_int(val=retweets),
        "likes": _safe_int(val=likes),
        "views": _safe_int(val=views),
    }


async def _click_topic_link_if_present(
    *, page: Any, topic_url: str, mouse: Any
) -> bool:
    """Attempt to click topic link element using EvasionMouse."""
    if not (hasattr(mouse, "human_click") and hasattr(page, "locator")):
        return False
    try:
        clean_q = topic_url.split("?q=")[-1] if "?q=" in topic_url else topic_url
        encoded_q = urllib.parse.quote(clean_q)

        for cand_sel in [
            f'a[href*="{clean_q}"]',
            f'a[href*="{encoded_q}"]',
            f'[data-testid="trend"]:has(a[href*="{clean_q}"])',
        ]:
            loc_res = page.locator(cand_sel)
            if inspect.isawaitable(loc_res):
                loc_res = await loc_res
            if hasattr(loc_res, "count"):
                c = loc_res.count()
                if inspect.isawaitable(c):
                    c = await c
                if c > 0:
                    first_loc = getattr(loc_res, "first", loc_res)
                    await mouse.human_click(locator=first_loc)
                    return True
    except Exception as click_err:
        logger.debug(f"Topic link click attempt failed: {click_err}")
    return False


async def _ensure_topic_page_navigation(
    *, page: Any, topic_url: str, mouse: Any | None = None
) -> None:
    """Navigate to topic URL using human mouse click if element is present, else stealth human_navigation."""
    page_url = getattr(page, "url", None)
    if page_url == topic_url:
        return

    clicked = False
    if mouse:
        clicked = await _click_topic_link_if_present(
            page=page, topic_url=topic_url, mouse=mouse
        )

    if not clicked:
        try:
            await human_navigation(page=page, url=topic_url)
        except Exception:
            goto_fn = getattr(page, "goto", None)
            if callable(goto_fn):
                res = goto_fn(topic_url, wait_until="domcontentloaded")
                if inspect.isawaitable(res):
                    await res


async def _click_locator_safe(*, locator: Any, mouse: Any | None = None) -> None:
    """Click a locator safely with mouse or direct click."""
    if mouse and hasattr(mouse, "human_click"):
        await mouse.human_click(locator=locator)
    else:
        click_res = locator.click()
        if inspect.isawaitable(click_res):
            await click_res


async def _try_click_navigation_locator(
    *, page: Any, selector: str, mouse: Any | None = None
) -> bool:
    """Find selector, check if present, click with mouse/direct, and delay."""
    if not hasattr(page, "locator"):
        return False
    try:
        loc_res = page.locator(selector)
        if inspect.isawaitable(loc_res):
            loc_res = await loc_res
        elem = getattr(loc_res, "first", loc_res)
        if hasattr(elem, "count"):
            c = elem.count()
            if inspect.isawaitable(c):
                c = await c
            if c > 0:
                await _click_locator_safe(locator=elem, mouse=mouse)
                await random_delay(min_sec=1.5, max_sec=2.5)
                return True
    except Exception:
        pass
    return False


async def _navigate_back_to_explore(*, page: Any, mouse: Any | None = None) -> None:
    """Return to Explore feed using Back button, Explore sidebar tab, or page history."""
    try:
        if await _try_click_navigation_locator(
            page=page, selector="[data-testid='app-bar-back']", mouse=mouse
        ):
            return

        if await _try_click_navigation_locator(
            page=page,
            selector="[data-testid='AppTabBar_Explore_Link'], a[href='/explore']",
            mouse=mouse,
        ):
            return

        if hasattr(page, "go_back"):
            back_res = page.go_back()
            if inspect.isawaitable(back_res):
                await back_res
            await random_delay(min_sec=1.5, max_sec=2.5)
    except Exception as back_err:
        logger.debug(f"Back navigation attempt caught exception: {back_err}")


async def _extract_single_topic_timeline(
    *,
    page: Any,
    topic_url: str,
    selectors: dict[str, Any],
    mouse: Any | None = None,
) -> tuple[str | None, list[dict[str, Any]]]:
    """Navigate to topic URL, human scroll, and extract Grok summary + top tweets."""
    await _ensure_topic_page_navigation(page=page, topic_url=topic_url, mouse=mouse)
    await random_delay(min_sec=1.5, max_sec=3.0)

    if mouse and hasattr(mouse, "human_scroll"):
        try:
            await mouse.human_scroll(scrolls=2)
        except Exception as scroll_err:
            logger.debug(f"Timeline scroll error: {scroll_err}")

    summary = None
    try:
        summary = await extract_grok_summary(page)
    except Exception as sum_err:
        logger.debug(
            f"Grok summary extraction skipped/failed for {topic_url}: {sum_err}"
        )

    raw_tweets = await extract_topic_tweets(
        page=page, topic_url=topic_url, selectors=selectors
    )

    tweets_data = [
        parsed
        for t in (raw_tweets or [])
        if (parsed := _parse_single_tweet(tweet=t)) is not None
    ]

    await _navigate_back_to_explore(page=page, mouse=mouse)
    return summary, tweets_data


def _get_topic_url(*, topic: Any) -> str:
    """Extract valid HTTP URL from topic dictionary or model."""
    if not topic:
        return ""
    raw_url = (
        topic.get("topic_url") or topic.get("url")
        if isinstance(topic, dict)
        else getattr(topic, "topic_url", None)
    )
    url = str(raw_url).strip() if raw_url is not None else ""
    return url if url.startswith(("http://", "https://")) else ""


async def _process_single_topic_extraction(
    *,
    page: Any,
    topic: Any,
    selectors: dict[str, Any],
    topic_tweets_map: dict[str, list[dict[str, Any]]],
    topic_summaries: dict[str, str],
    failed_topics: list[dict[str, str]],
    mouse: Any | None = None,
) -> None:
    """Extract timeline for a single topic and record outcomes."""
    topic_url = _get_topic_url(topic=topic)
    if not topic_url:
        return

    try:
        summary, tweets = await _extract_single_topic_timeline(
            page=page, topic_url=topic_url, selectors=selectors, mouse=mouse
        )
        if summary:
            topic_summaries[topic_url] = str(summary)
        topic_tweets_map[topic_url] = tweets
    except Exception as e:
        logger.warning(f"Error extracting timeline for topic {topic_url}: {e}")
        failed_topics.append({"topic_url": topic_url, "reason": str(e)})


async def extract_topic_timelines(
    *,
    page: Any,
    scraped_topics: list[dict[str, Any]],
    max_topics: int,
    mouse: Any | None = None,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, str], list[dict[str, str]]]:
    """Loop through top N topics to extract timelines and summaries."""
    topic_tweets_map: dict[str, list[dict[str, Any]]] = {}
    topic_summaries: dict[str, str] = {}
    failed_topics: list[dict[str, str]] = []

    if not scraped_topics or page is None:
        return topic_tweets_map, topic_summaries, failed_topics

    selectors = _load_selectors()
    candidates = list(scraped_topics)
    selected_topics = (
        random.sample(candidates, max_topics)
        if len(candidates) > max_topics
        else candidates[:max_topics]
    )

    for idx, topic in enumerate(selected_topics):
        if idx > 0:
            await random_delay(min_sec=2.0, max_sec=4.0)
        await _process_single_topic_extraction(
            page=page,
            topic=topic,
            selectors=selectors,
            topic_tweets_map=topic_tweets_map,
            topic_summaries=topic_summaries,
            failed_topics=failed_topics,
            mouse=mouse,
        )

    return topic_tweets_map, topic_summaries, failed_topics
