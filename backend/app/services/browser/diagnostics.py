"""DOM diagnostic utilities for LangGraph self-healing agents.

These functions extract structural information from web pages for analysis
by LLM agents when selectors break or page structure changes.

All functions return data directly (dict/str) for token-efficient tool calls.
File writing is optional — pass output_path=None to skip disk I/O.
"""

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


async def extract_dom_snapshot(
    page,
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

    return html_content


async def extract_structural_map(
    page,
    selector: str,
    *,
    output_path: str | Path | None = None,
) -> dict | None:
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

    return structure_data


async def detect_page_state(page) -> str:
    """Detect the current state of the X.com page.

    Returns one of:
        'ok'           — Normal page, ready for scraping.
        'logged_out'   — Session expired, redirected to login.
        'rate_limited' — Hit a rate limit or "Something went wrong" error.
        'captcha'      — CAPTCHA challenge detected.
        'empty'        — Page loaded but no meaningful content found.
        'unknown'      — Unrecognized state.
    """
    url = page.url

    # Check for login redirect
    if "/login" in url or "/i/flow/login" in url:
        return "logged_out"

    # Check for "Something went wrong" error banner
    try:
        error_count = await page.locator("text=Something went wrong").count()
        if error_count > 0:
            return "rate_limited"
    except Exception:
        pass

    # Check for rate limit page (HTTP 429-style pages)
    try:
        rate_limit_count = await page.locator("text=Rate limit exceeded").count()
        if rate_limit_count > 0:
            return "rate_limited"
    except Exception:
        pass

    # Check for CAPTCHA — only flag if visible and takes up real screen space.
    # X.com uses hidden iframe[src*='challenge'] for normal tracking; those
    # are NOT actual CAPTCHA walls and must not trigger a false positive.
    try:
        captcha_locators = await page.locator("iframe[src*='captcha']").all()
        for iframe in captcha_locators:
            if await iframe.is_visible():
                box = await iframe.bounding_box()
                if box and box["width"] > 100 and box["height"] > 100:
                    logger.warning(
                        f"CAPTCHA iframe detected: {box['width']}x{box['height']}px"
                    )
                    return "captcha"
    except Exception:
        pass

    # Check for suspended/locked account
    try:
        suspended_count = await page.locator(
            "text=Your account has been locked"
        ).count()
        if suspended_count > 0:
            return "rate_limited"
    except Exception:
        pass

    return "ok"


async def extract_grok_summary(page) -> str:
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
        return await page.evaluate(js_code)
    except Exception as e:
        logger.debug(f"JS summary extraction failed: {e}")
        return ""
