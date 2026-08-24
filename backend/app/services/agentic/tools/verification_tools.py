"""Ground Truth Live Verification Tools for LinkX Agentic Supervisor."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any

from sqlmodel import Session

from app import crud
from app.services.agentic.schemas import (
    PostUrlStatusReport,
    ProfileVerificationReport,
)
from app.services.agentic.tools.common import get_active_page, resolve_session
from app.services.browser.actions import normalize_post_text
from app.services.browser.manager import BrowserManager

logger = logging.getLogger(__name__)


def _fuzzy_text_match(*, expected: str, actual: str) -> tuple[bool, float]:
    """Perform sanitized substring and token overlap matching between expected and actual text."""
    exp_norm = normalize_post_text(expected).lower().strip()
    act_norm = normalize_post_text(actual).lower().strip()

    if not exp_norm or not act_norm:
        return False, 0.0

    # Exact or substring match
    if exp_norm in act_norm or act_norm in exp_norm:
        return True, 1.0

    # Prefix match (first 40 characters)
    exp_prefix = exp_norm[:40]
    if len(exp_prefix) >= 15 and exp_prefix in act_norm:
        return True, 0.95

    # Token set intersection
    exp_tokens = set(re.findall(r"\w+", exp_norm))
    act_tokens = set(re.findall(r"\w+", act_norm))
    if not exp_tokens or not act_tokens:
        return False, 0.0

    overlap = len(exp_tokens.intersection(act_tokens))
    ratio = overlap / max(len(exp_tokens), 1)
    return (ratio >= 0.7), ratio


async def _extract_profile_timeline_tweets(
    *,
    page: Any,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Extract top tweet cards from a live profile timeline."""
    try:
        await page.wait_for_selector("[data-testid='tweet']", timeout=10000)
    except Exception:
        return []

    raw_tweets = await page.evaluate(
        """(maxItems) => {
            const tweets = document.querySelectorAll('[data-testid="tweet"]');
            const results = [];
            for (let i = 0; i < Math.min(tweets.length, maxItems); i++) {
                const el = tweets[i];
                const textEl = el.querySelector('[data-testid="tweetText"]');
                const text = textEl ? textEl.innerText : el.innerText;

                // Try to find status link
                const links = Array.from(el.querySelectorAll('a[href*="/status/"]'));
                const statusLink = links.length > 0 ? links[0].href : null;
                const statusId = statusLink ? statusLink.split('/status/')[1]?.split('?')[0] : null;

                results.push({
                    text: text,
                    status_url: statusLink,
                    status_id: statusId
                });
            }
            return results;
        }""",
        limit,
    )
    return list(raw_tweets) if isinstance(raw_tweets, list) else []


def _match_timeline_tweets(
    *,
    timeline_tweets: list[dict[str, Any]],
    expected_content: str,
    expected_ext_id: str | None,
) -> tuple[bool, str | None, str | None, float]:
    """Find best matching tweet on live timeline by external ID or fuzzy text."""
    best_confidence = 0.0
    matched_text: str | None = None
    matched_id: str | None = None

    for t in timeline_tweets:
        t_text = t.get("text", "")
        t_id = t.get("status_id")

        if (
            expected_ext_id
            and t_id
            and (expected_ext_id in str(t_id) or str(t_id) in expected_ext_id)
        ):
            return True, t_text, str(t_id), 1.0

        is_match, conf = _fuzzy_text_match(expected=expected_content, actual=t_text)
        if is_match and conf > best_confidence:
            best_confidence = conf
            matched_text = t_text
            matched_id = str(t_id) if t_id else None

    return best_confidence > 0.0, matched_text, matched_id, best_confidence


async def verify_post_on_live_profile(
    *,
    user_id: str,
    expected_post_id: str | None = None,
    max_tweets_to_check: int = 5,
    session: Session | None = None,
) -> ProfileVerificationReport:
    """Open authenticated X session, navigate to live user profile, scrape top tweets,
    and verify whether the latest DB post physically exists on the live profile feed."""
    try:
        user_uuid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        return ProfileVerificationReport(
            verified_live=False,
            profile_url="unknown",
            error=f"Invalid user_id: {user_id}",
        )

    # 1. Fetch expected post from DB
    expected_content: str | None = None
    expected_ext_id: str | None = None

    with resolve_session(session=session) as s:
        if expected_post_id:
            try:
                db_p = crud.get_post(session=s, post_id=uuid.UUID(expected_post_id))
            except Exception:
                db_p = None
        else:
            db_p = crud.get_latest_published_post(
                session=s, user_id=user_uuid, platform="x"
            )

        if db_p:
            expected_content = db_p.content
            expected_ext_id = db_p.external_post_id

    if not expected_content:
        return ProfileVerificationReport(
            verified_live=False,
            profile_url="unknown",
            error="No published post found in database to verify.",
        )

    # 2. Resolve username from session metadata
    manager = BrowserManager(user_id=user_id)
    if not manager.session_exists("x"):
        return ProfileVerificationReport(
            verified_live=False,
            profile_url="unknown",
            expected_content=expected_content,
            error="No active X.com browser session found.",
        )

    meta = manager.read_session_metadata("x")
    username = meta.get("username")
    profile_url = f"https://x.com/{username}" if username else "https://x.com/home"

    # 3. Launch browser & scrape live timeline
    try:
        async with manager.get_context("x", headless=True) as context:
            page = await get_active_page(context=context)

            await page.goto(profile_url, wait_until="domcontentloaded", timeout=20000)
            timeline_tweets = await _extract_profile_timeline_tweets(
                page=page, limit=max_tweets_to_check
            )

            match_found, matched_text, matched_id, best_confidence = (
                _match_timeline_tweets(
                    timeline_tweets=timeline_tweets,
                    expected_content=expected_content,
                    expected_ext_id=expected_ext_id,
                )
            )

            return ProfileVerificationReport(
                verified_live=match_found,
                expected_content=expected_content,
                profile_url=profile_url,
                latest_live_tweets=timeline_tweets,
                match_found=match_found,
                matched_tweet_text=matched_text,
                matched_tweet_id=matched_id,
                match_confidence=best_confidence,
            )
    except Exception as e:
        logger.error(f"Error during profile verification: {e}")
        return ProfileVerificationReport(
            verified_live=False,
            expected_content=expected_content,
            profile_url=profile_url,
            error=str(e),
        )


async def verify_post_url_status(
    *,
    post_url: str,
    user_id: str,
) -> PostUrlStatusReport:
    """Navigate directly to a post URL on live X to confirm it is reachable and active."""
    manager = BrowserManager(user_id=user_id)
    if not manager.session_exists("x"):
        return PostUrlStatusReport(
            post_url=post_url,
            is_live=False,
            error="X session not connected.",
        )

    try:
        async with manager.get_context("x", headless=True) as context:
            page = await get_active_page(context=context)

            resp = await page.goto(
                post_url, wait_until="domcontentloaded", timeout=20000
            )
            status_code = resp.status if resp else 200

            body_text = await page.inner_text("body")
            is_deleted = (
                "This Tweet is unavailable" in body_text
                or "Hmm...this page doesn’t exist" in body_text
            )
            is_live = (status_code == 200) and not is_deleted

            return PostUrlStatusReport(
                post_url=post_url,
                is_live=is_live,
                status_code=status_code,
                error="Post unavailable or deleted" if is_deleted else None,
            )
    except Exception as e:
        return PostUrlStatusReport(
            post_url=post_url,
            is_live=False,
            error=str(e),
        )
