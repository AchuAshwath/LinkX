"""Browser inspection, selector verification, and self-healing tools."""

from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class SelectorHealingError(Exception):
    """Raised when a broken selector cannot be automatically healed."""

    pass


async def get_dom_snippet(
    page: Any,
    *,
    selector: str | None = None,
    max_chars: int = 5000,
) -> str:
    """Extract a sanitized, pruned semantic DOM representation for LLM diagnosis."""
    js_code = """
    (targetSelector) => {
        const root = targetSelector ? document.querySelector(targetSelector) : document.body;
        if (!root) return "<div>Element not found</div>";

        function serialize(node, depth = 0) {
            if (depth > 18) return "";
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent.trim();
                return text.length > 0 ? text : "";
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return "";

            const tag = node.tagName.toLowerCase();
            if (['script', 'style', 'svg', 'path', 'noscript', 'canvas', 'iframe'].includes(tag)) {
                return "";
            }

            let attrs = [];
            for (const attr of node.attributes) {
                if (['id', 'data-testid', 'role', 'aria-label', 'href', 'placeholder', 'name', 'type'].includes(attr.name)) {
                    const cleanVal = attr.value.replace(/[\\r\\n\\t]+/g, ' ').substring(0, 100);
                    attrs.push(`${attr.name}="${cleanVal}"`);
                }
            }
            const attrStr = attrs.length ? " " + attrs.join(" ") : "";

            let inner = "";
            for (const child of node.childNodes) {
                inner += serialize(child, depth + 1);
            }

            // If it is an un-attributed wrapper div/span with text or inner content, collapse it to save depth and tokens
            if (!attrs.length && ['div', 'span'].includes(tag)) {
                return inner;
            }

            if (!inner && !attrs.length) return "";
            return `<${tag}${attrStr}>${inner}</${tag}>`;
        }

        return serialize(root);
    }
    """
    try:
        raw_dom = await page.evaluate(js_code, selector)
        cleaned = " ".join(str(raw_dom).split())
        return cleaned[:max_chars]
    except Exception as e:
        logger.warning(f"Failed to extract DOM snippet: {e}")
        return f"<div>Error extracting DOM: {e}</div>"


DISALLOWED_GENERIC_SELECTORS = {
    "*",
    "body",
    "html",
    "div",
    "span",
    "p",
    "main",
    "header",
    "footer",
    "section",
    "article",
}


async def _check_nth_elements(locator: Any, count: int, timeout_ms: int) -> bool:
    """Check if any subsequent elements (up to index 2) are visible."""
    if not hasattr(locator, "nth"):
        return False
    for i in range(1, min(count, 3)):
        elem = locator.nth(i)
        if hasattr(elem, "is_visible") and await elem.is_visible(timeout=timeout_ms):
            return True
    return False


async def _check_elements_visibility(
    locator: Any, *, count: int, timeout_ms: int
) -> bool:
    """Helper to check visibility of candidate element(s)."""
    target = getattr(locator, "first", locator)
    if hasattr(target, "is_visible") and await target.is_visible(timeout=timeout_ms):
        return True
    if count > 1:
        return await _check_nth_elements(locator, count, timeout_ms)
    return False


async def validate_selector_candidate(
    page: Any,
    *,
    selector: str,
    timeout_ms: int = 2500,
) -> dict[str, Any]:
    """Test if a candidate CSS or XPath selector matches a visible element on the page."""
    clean_sel = selector.strip().lower()
    if clean_sel in DISALLOWED_GENERIC_SELECTORS:
        return {
            "found": False,
            "visible": False,
            "count": 0,
            "error": f"Selector '{selector}' is too generic and matches entire page layout containers",
        }

    try:
        locator = page.locator(selector)
        count = await locator.count()
        if count == 0:
            return {"found": False, "visible": False, "count": 0, "error": None}

        is_visible = await _check_elements_visibility(
            locator, count=count, timeout_ms=timeout_ms
        )
        return {
            "found": True,
            "visible": is_visible,
            "count": count,
            "error": None,
        }
    except Exception as e:
        return {
            "found": False,
            "visible": False,
            "count": 0,
            "error": str(e),
        }


def _load_config_dict(path: Path) -> dict[str, Any] | None:
    """Read and validate JSON configuration file dictionary."""
    if not path.exists() or not os.access(path, os.W_OK):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            content = f.read().strip()
            if not content:
                return None
            data = json.loads(content)
            return data if isinstance(data, dict) else None
    except Exception:
        return None


def _write_config_atomically(path: Path, data: dict[str, Any]) -> None:
    """Atomically write JSON data to path using temporary file replace."""
    parent_dir = path.parent
    with tempfile.NamedTemporaryFile(
        "w", dir=parent_dir, delete=False, encoding="utf-8"
    ) as tf:
        json.dump(data, tf, indent=2)
        temp_name = tf.name
    os.replace(temp_name, path)


def patch_selector_config(
    *,
    config_path: str | Path,
    key_path: str,
    new_selector: str,
) -> bool:
    """Patch a selector in a JSON configuration file on disk atomically."""
    path = Path(config_path)
    data = _load_config_dict(path)
    if data is None:
        logger.error(f"Failed to load valid writable config at {path}")
        return False

    try:
        _set_nested_selector(data, key_path, new_selector)
        _write_config_atomically(path, data)
        logger.info(f"Successfully patched {key_path} -> '{new_selector}' in {path}")
        return True
    except Exception as e:
        logger.error(f"Failed to patch selector in {path}: {e}")
        return False


def _get_nested_selector(selectors_dict: dict[str, Any], key_path: str) -> str | None:
    """Retrieve a selector from a nested dictionary using dot notation."""
    if not isinstance(selectors_dict, dict):
        return None
    keys = key_path.split(".")
    current: Any = selectors_dict
    for k in keys:
        if isinstance(current, dict) and k in current:
            current = current[k]
        else:
            return None
    return str(current) if isinstance(current, (str, int)) else None


def _set_nested_selector(
    selectors_dict: dict[str, Any], key_path: str, new_selector: str
) -> None:
    """Update a selector in a nested dictionary using dot notation."""
    if not isinstance(selectors_dict, dict):
        raise TypeError(
            f"selectors_dict must be a dict, got {type(selectors_dict).__name__}"
        )
    keys = key_path.split(".")
    current = selectors_dict
    for k in keys[:-1]:
        if k not in current or not isinstance(current[k], dict):
            current[k] = {}
        current = current[k]
    current[keys[-1]] = new_selector


async def _probe_current_selector(
    page: Any, current_selector: str | None, timeout_ms: int
) -> Any:
    """Probe existing selector; return locator if visible."""
    if not current_selector:
        return None
    probe = await validate_selector_candidate(
        page=page, selector=current_selector, timeout_ms=timeout_ms
    )
    if probe["found"] and probe["visible"]:
        loc = page.locator(current_selector)
        return getattr(loc, "first", loc)
    return None


async def find_or_heal_element(
    page: Any,
    *,
    selector_key: str,
    selectors_dict: dict[str, Any],
    config_path: str | Path,
    timeout_ms: int = 2500,
) -> Any:
    """Locate an element; if missing, trigger the LangGraph self-healing supervisor."""
    import app.services.agentic.self_healing_graph as shg

    current_selector = _get_nested_selector(selectors_dict, selector_key)
    existing_loc = await _probe_current_selector(page, current_selector, timeout_ms)
    if existing_loc is not None:
        return existing_loc

    logger.warning(
        f"Selector '{selector_key}' ('{current_selector}') failed or missing. Triggering self-healing..."
    )

    healed_selector = await shg.heal_selector(
        page=page,
        failed_selector_key=selector_key,
        config_path=config_path,
        selectors_dict=selectors_dict,
    )

    if healed_selector:
        _set_nested_selector(selectors_dict, selector_key, healed_selector)
        loc = page.locator(healed_selector)
        return getattr(loc, "first", loc)

    raise SelectorHealingError(
        f"Unable to resolve or heal selector '{selector_key}' on page {getattr(page, 'url', 'unknown')}"
    )
