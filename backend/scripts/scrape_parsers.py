"""Parsing utilities for X.com trending topics and metadata."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Any

from rebrowser_playwright.async_api import Error as PlaywrightError

logger = logging.getLogger(__name__)


async def _expand_tweet(locator: Any) -> None:
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


async def extract_tweet_data(locator: Any) -> dict[str, Any] | None:
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


def _clean_category(category: str | None) -> str | None:
    """Clean category string to avoid duplicate 'Trending' suffixes in UI."""
    if not category:
        return None
    cat = category.strip()
    for marker in (
        "· Trending in",
        "Trending in",
        "· Trending",
        "Trending ·",
        "Trending",
    ):
        if marker in cat:
            cat = cat.replace(marker, "").strip()
    cat = cat.strip(" ·-")
    return cat if cat else None


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
