"""Verification matching and network reachability probe helpers for VerificationGraph."""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.services.browser.actions import normalize_post_text

logger = logging.getLogger(__name__)

TOMBSTONE_PHRASES = (
    "This Tweet is unavailable",
    "Hmm...this page doesn’t exist",
    "Hmm...this page doesn't exist",
    "This account has been suspended",
    "Page not found",
    "Post not found",
)


def calculate_token_overlap(*, expected: str, actual: str) -> tuple[bool, float]:
    """Compute token intersection ratio between normalized strings."""
    exp_tokens = set(re.findall(r"\w+", expected))
    act_tokens = set(re.findall(r"\w+", actual))
    if not exp_tokens or not act_tokens:
        return False, 0.0
    overlap = len(exp_tokens.intersection(act_tokens))
    ratio = overlap / max(len(exp_tokens), 1)
    return (ratio >= 0.70), round(ratio, 3)


def fuzzy_match_text(*, expected: str, actual: str) -> tuple[bool, float]:
    """Perform sanitized substring and token overlap matching between expected and actual text."""
    exp_norm = normalize_post_text(expected).lower().strip()
    act_norm = normalize_post_text(actual).lower().strip()

    if not exp_norm or not act_norm:
        return False, 0.0

    if exp_norm in act_norm or act_norm in exp_norm:
        return True, 1.0

    if len(exp_norm[:40]) >= 15 and exp_norm[:40] in act_norm:
        return True, 0.95

    return calculate_token_overlap(expected=exp_norm, actual=act_norm)


def _is_matching_id(*, expected_id: str | None, actual_id: Any) -> bool:
    """Check if actual external ID matches expected ID."""
    if not expected_id or not actual_id:
        return False
    str_actual = str(actual_id).strip()
    clean_expected = expected_id.split(":")[-1] if ":" in expected_id else expected_id
    clean_actual = str_actual.split(":")[-1] if ":" in str_actual else str_actual
    return clean_expected == clean_actual or clean_expected in clean_actual


def _find_id_match(
    *, timeline_tweets: list[dict[str, Any]], expected_ext_id: str | None
) -> tuple[str, str] | None:
    """Find immediate match by external tweet status ID."""
    if not expected_ext_id:
        return None
    for t in timeline_tweets:
        t_id = t.get("status_id")
        if _is_matching_id(expected_id=expected_ext_id, actual_id=t_id):
            return t.get("text", ""), str(t_id)
    return None


def _find_best_fuzzy_match(
    *, timeline_tweets: list[dict[str, Any]], expected_content: str
) -> tuple[str | None, str | None, float]:
    """Score timeline tweets by text similarity and return highest confidence match."""
    best_conf = 0.0
    matched_text: str | None = None
    matched_id: str | None = None
    for t in timeline_tweets:
        t_text = t.get("text", "")
        t_id = t.get("status_id")
        is_match, conf = fuzzy_match_text(expected=expected_content, actual=t_text)
        if is_match and conf > best_conf:
            best_conf = conf
            matched_text = t_text
            matched_id = str(t_id) if t_id else None
    return matched_text, matched_id, best_conf


def match_post_on_timeline(
    *,
    expected_content: str,
    expected_ext_id: str | None,
    timeline_tweets: list[dict[str, Any]],
) -> tuple[bool, str | None, str | None, float]:
    """Find matching tweet on live timeline by external ID or fuzzy text."""
    id_match = _find_id_match(
        timeline_tweets=timeline_tweets, expected_ext_id=expected_ext_id
    )
    if id_match:
        return True, id_match[0], id_match[1], 1.0

    matched_text, matched_id, conf = _find_best_fuzzy_match(
        timeline_tweets=timeline_tweets, expected_content=expected_content
    )
    return (conf >= 0.70), matched_text, matched_id, conf


def _format_x_url(ext_id: str) -> str:
    clean_id = ext_id.split("x:")[-1] if "x:" in ext_id else ext_id
    return f"https://x.com/i/status/{clean_id}"


def _format_linkedin_url(ext_id: str) -> str:
    clean_id = ext_id.split("linkedin:")[-1] if "linkedin:" in ext_id else ext_id
    urn = clean_id if clean_id.startswith("urn:li:") else f"urn:li:share:{clean_id}"
    return f"https://www.linkedin.com/feed/update/{urn}"


def format_canonical_post_url(*, platform: str, ext_id: str | None) -> str | None:
    """Format live post URL for X or LinkedIn from external ID."""
    if not ext_id:
        return None
    clean_platform = platform.lower().strip()
    if clean_platform in ("x", "twitter") or "x:" in ext_id:
        return _format_x_url(ext_id)
    if clean_platform == "linkedin" or "linkedin:" in ext_id:
        return _format_linkedin_url(ext_id)
    if clean_platform in ("both", "all", "linkx"):
        if ext_id.isdigit():
            return _format_x_url(ext_id)
        if "urn:li:" in ext_id:
            return _format_linkedin_url(ext_id)
    return None


async def probe_url_reachability(
    *, url: str, timeout_sec: float = 8.0
) -> tuple[bool, int, str | None]:
    """Probe a public post URL via HTTP to verify reachability and detect tombstone pages."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )
    }
    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=timeout_sec
        ) as client:
            resp = await client.get(url, headers=headers)
            status_code = resp.status_code
            if status_code >= 400:
                return False, status_code, f"HTTP Error {status_code}"

            body_text = resp.text
            for phrase in TOMBSTONE_PHRASES:
                if phrase in body_text:
                    return False, 200, f"Tombstone detected: '{phrase}'"

            return True, status_code, None
    except Exception as exc:
        logger.debug(f"Reachability probe failed for {url}: {exc}")
        return False, 0, str(exc)
