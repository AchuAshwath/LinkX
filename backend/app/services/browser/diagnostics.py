"""DOM diagnostic utilities for LangGraph self-healing agents.

These functions extract structural information from web pages for analysis
by LLM agents when selectors break or page structure changes.

All functions return data directly (dict/str) for token-efficient tool calls.
File writing is optional — pass output_path=None to skip disk I/O.
"""

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


async def extract_dom_snapshot(
    page: Any,
    *,
    output_path: str | Path | None = None,
) -> str:
    """Extract the full HTML DOM of the current page.

    Returns the raw HTML string. Optionally writes to disk if output_path is set.
    Useful for LLM agents to analyze the page structure when selectors break.
    """
    logger.info("Extracting DOM snapshot...")
    html_content = await page.content()

    if output_path:
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            f.write(html_content)
        logger.info(f"Saved full HTML snapshot to {out}")

    return str(html_content)


async def extract_structural_map(
    page: Any,
    selector: str,
    *,
    output_path: str | Path | None = None,
) -> dict[str, Any] | None:
    """Extract a simplified JSON structure of a specific DOM element.

    Strips away all styling and extraneous tags, keeping only semantic tags,
    data-testid, role, aria-label, href, and text content.

    Returns the structural map as a dict (or None if element not found).
    Optionally writes to disk if output_path is set.
    """
    logger.info(f"Extracting structural map for selector: {selector}")

    js_code = """
    (selector) => {
        function serializeNode(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                let text = node.textContent.trim();
                return text ? text : null;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return null;

            // Skip script, style, svg
            if (['SCRIPT', 'STYLE', 'SVG', 'PATH'].includes(node.tagName)) return null;

            let obj = { tag: node.tagName };
            if (node.id) obj.id = node.id;

            let attrs = {};
            for (let attr of node.attributes) {
                if (['data-testid', 'role', 'aria-label', 'href'].includes(attr.name)) {
                    attrs[attr.name] = attr.value;
                }
            }
            if (Object.keys(attrs).length > 0) obj.attrs = attrs;

            let children = [];
            for (let child of node.childNodes) {
                let childData = serializeNode(child);
                if (childData) children.push(childData);
            }

            if (children.length > 0) obj.children = children;

            return Object.keys(obj).length === 1 && obj.tag ? null : obj;
        }

        let root = document.querySelector(selector);
        if (!root) return null;
        return serializeNode(root);
    }
    """

    structure_data = await page.evaluate(js_code, selector)

    if output_path and structure_data:
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(structure_data, f, indent=2)
        logger.info(f"Saved structural map to {out}")

    return structure_data  # type: ignore


CHALLENGE_SELECTORS = (
    "iframe[src*='captcha']",
    "iframe[src*='arkose']",
    "iframe[src*='arkoselabs']",
    "iframe[src*='turnstile']",
    "iframe[src*='challenges.cloudflare.com']",
    "iframe[title*='challenge']",
    "iframe[title*='reCAPTCHA']",
    "iframe[title*='Arkose']",
)


async def _check_url_and_title(page: Any) -> str | None:
    """Check for login redirects or anti-bot challenge titles."""
    url = getattr(page, "url", "")
    if "/login" in url or "/i/flow/login" in url:
        return "logged_out"

    try:
        title = (await page.title()).lower() if hasattr(page, "title") else ""
        if any(
            h in title
            for h in ("just a moment", "attention required", "security check")
        ):
            return "captcha"
    except Exception:
        pass
    return None


async def _check_error_banners(page: Any) -> str | None:
    """Check for rate limit or generic error text banners."""
    for text_sel in (
        "text=Something went wrong",
        "text=Rate limit exceeded",
        "text=Your account has been locked",
    ):
        try:
            if await page.locator(text_sel).count() > 0:
                return "rate_limited"
        except Exception:
            pass
    return None


async def _check_challenge_iframes(page: Any) -> str | None:
    """Check for visible, non-tracking CAPTCHA or challenge iframes/wrappers."""
    for sel in CHALLENGE_SELECTORS:
        try:
            locators = await page.locator(sel).all()
            for iframe in locators:
                if await iframe.is_visible():
                    box = await iframe.bounding_box()
                    if box and box["width"] > 100 and box["height"] > 100:
                        return "captcha"
        except Exception:
            pass

    try:
        cf_count = await page.locator(
            "#challenge-running, #challenge-stage, div.cf-turnstile-wrapper"
        ).count()
        if cf_count > 0:
            return "captcha"
    except Exception:
        pass
    return None


async def detect_page_state(page: Any) -> str:
    """Classify the current page into a sentinel state.

    Returns one of: 'ok', 'logged_out', 'rate_limited', 'captcha', 'error'.
    """
    url_state = await _check_url_and_title(page)
    if url_state:
        return url_state

    banner_state = await _check_error_banners(page)
    if banner_state:
        return banner_state

    challenge_state = await _check_challenge_iframes(page)
    if challenge_state:
        return challenge_state

    return "ok"


async def extract_grok_summary(page: Any) -> str:
    """Extract the Grok/X summary from a trending topic page.

    Uses a two-phase approach:
      1. Structural anchor: find the div immediately before the Trend Timeline nav.
      2. Longest-span fallback: scan all non-tweet spans for the longest text block.

    Returns the summary text, or empty string if nothing found.
    """
    js_code = """() => {
        // Phase 1: Structural anchor — most reliable
        let nav = document.querySelector('nav[aria-label="Trend Timeline"]');
        if (nav) {
            let container = nav.previousElementSibling;
            if (container) {
                let text = container.innerText.trim();
                if (text.length > 50) return text;
            }
        }

        // Phase 2: Longest non-tweet span fallback
        let timeline = document.querySelector('div[aria-label="Home timeline"]')
            || document.querySelector('[data-testid="primaryColumn"]');
        if (!timeline) return "";

        let spans = Array.from(timeline.querySelectorAll('span'));
        let validSpans = spans.filter(span => !span.closest('[data-testid="tweet"]'));

        let longestText = "";
        for (let span of validSpans) {
            let text = span.textContent.trim();
            if (text.length > longestText.length && text.length > 50) {
                if (!text.includes("This story is a summary")
                    && !text.includes("Grok can make mistakes")
                    && !text.includes("Sign up")
                    && !text.includes("Log in")) {
                    longestText = text;
                }
            }
        }
        return longestText;
    }"""

    try:
        return str(await page.evaluate(js_code))
    except Exception as e:
        logger.debug(f"JS summary extraction failed: {e}")
        return ""
