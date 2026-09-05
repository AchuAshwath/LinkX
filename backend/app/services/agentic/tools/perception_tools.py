"""Live Browser Scraping and Environmental Perception Tools for LinkX Agentic Supervisor."""

from __future__ import annotations

import ipaddress
import logging
import re
from typing import Any
from urllib.parse import SplitResult, urlsplit

from app.services.agentic.tools.common import get_active_page
from app.services.browser.actions import human_navigation, random_delay
from app.services.browser.diagnostics import extract_grok_summary
from app.services.browser.manager import BrowserManager
from scripts.scrape_trending_topics import extract_topic_tweets, scrape_trending_topics

logger = logging.getLogger(__name__)

ALLOWED_TOPIC_DOMAINS: frozenset[str] = frozenset({"x.com", "twitter.com"})
ALLOWED_SCHEMES: frozenset[str] = frozenset({"https", "http"})
ALLOWED_PORTS: frozenset[int | None] = frozenset({None, 80, 443})
_DNS_LABEL_REGEX = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")


def _is_ip_address(*, host: str) -> bool:
    """Check if the provided host string is an IPv4 or IPv6 address."""
    clean_host = host.strip("[]")
    try:
        ipaddress.ip_address(clean_host)
        return True
    except ValueError:
        return False


def _is_valid_dns_label(*, label: str) -> bool:
    """Check if a label complies with RFC 1123 hostname standards."""
    return bool(_DNS_LABEL_REGEX.match(label))


def _has_valid_domain_suffix(*, labels: list[str]) -> bool:
    """Verify that domain labels end in an allowed domain suffix."""
    if len(labels) < 2:
        return False
    suffix = f"{labels[-2]}.{labels[-1]}"
    return suffix in ALLOWED_TOPIC_DOMAINS


def _is_valid_hostname(*, hostname: str | None) -> bool:
    """Verify that hostname exists, is not an IP, and has valid DNS labels."""
    if not hostname:
        return False
    clean_host = hostname.lower()
    if _is_ip_address(host=clean_host):
        return False
    labels = clean_host.split(".")
    if not all(_is_valid_dns_label(label=lbl) for lbl in labels):
        return False
    return _has_valid_domain_suffix(labels=labels)


def _safe_get_port(*, parsed: SplitResult) -> int | None | str:
    """Safely extract port without crashing on non-numeric or out-of-range port strings."""
    try:
        return parsed.port
    except ValueError:
        return "invalid"


def _has_valid_scheme_and_port(*, scheme: str, port: Any) -> bool:
    """Validate that the URL scheme and port are standard and allowed."""
    if scheme.lower() not in ALLOWED_SCHEMES:
        return False
    return port in ALLOWED_PORTS


def _has_userinfo(*, username: str | None, password: str | None) -> bool:
    """Check if URL components contain embedded user credentials."""
    if username is not None:
        return True
    return password is not None


def _has_disallowed_characters(*, url: str) -> bool:
    """Check for backslashes, control characters, or non-ASCII characters."""
    if "\\" in url:
        return True
    return any(ord(c) <= 32 or ord(c) >= 127 for c in url)


def _parse_url(*, url: str) -> SplitResult | None:
    """Safely parse a non-empty string into URL split components."""
    if not isinstance(url, str):
        return None
    trimmed = url.strip()
    if not trimmed or _has_disallowed_characters(url=trimmed):
        return None
    try:
        return urlsplit(trimmed)
    except ValueError:
        return None


def is_safe_topic_url(*, url: str) -> bool:
    """Validate that a topic URL belongs to allowed X/Twitter domains to prevent SSRF."""
    parsed = _parse_url(url=url)
    if parsed is None:
        return False
    port = _safe_get_port(parsed=parsed)
    if not _has_valid_scheme_and_port(scheme=parsed.scheme, port=port):
        return False
    if _has_userinfo(username=parsed.username, password=parsed.password):
        return False
    return _is_valid_hostname(hostname=parsed.hostname)


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


def _format_extracted_tweets(
    *, raw_tweets: list[Any], max_tweets: int
) -> list[dict[str, Any]]:
    """Format raw tweet instances into lean dictionary representations."""
    return [
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


def _is_disallowed_redirect(*, current_url: Any) -> bool:
    """Check if the post-navigation destination URL violates domain safety rules."""
    if not isinstance(current_url, str) or not current_url:
        return False
    return not is_safe_topic_url(url=current_url)


async def _navigate_and_extract_timeline(
    *, page: Any, topic_url: str, max_tweets: int
) -> dict[str, Any]:
    """Navigate to topic URL and extract Grok summary and tweets."""
    try:
        await human_navigation(page=page, url=topic_url)
    except Exception:
        await page.goto(topic_url, wait_until="domcontentloaded", timeout=20000)

    current_url = getattr(page, "url", None)
    if _is_disallowed_redirect(current_url=current_url):
        logger.warning(
            "Navigation redirected to unauthorized destination: %s", current_url
        )
        return {
            "success": False,
            "error": f"Navigation redirected to unauthorized URL '{current_url}'.",
            "tweets": [],
            "grok_summary": "",
        }

    await random_delay(min_sec=1.0, max_sec=2.0)
    summary = await extract_grok_summary(page)
    raw_tweets = await extract_topic_tweets(
        page=page,
        topic_url=page.url,
        selectors={},
    )
    return {
        "success": True,
        "topic_url": topic_url,
        "grok_summary": summary,
        "tweets": _format_extracted_tweets(
            raw_tweets=raw_tweets or [], max_tweets=max_tweets
        ),
    }


async def scrape_topic_timeline(
    *,
    topic_url: str,
    user_id: str,
    max_tweets: int = 5,
) -> dict[str, Any]:
    """Navigate directly to a specific topic URL on live X, extract Grok summary & top tweets."""
    if not is_safe_topic_url(url=topic_url):
        logger.warning(
            "Blocked potentially malicious or non-whitelisted topic URL: %s", topic_url
        )
        return {
            "success": False,
            "error": f"Invalid or unauthorized topic URL '{topic_url}'. Only verified X/Twitter domains are allowed.",
            "tweets": [],
            "grok_summary": "",
        }

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
            return await _navigate_and_extract_timeline(
                page=page, topic_url=topic_url, max_tweets=max_tweets
            )
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
