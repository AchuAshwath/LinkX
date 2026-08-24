"""DOM Diagnostics and Selector Self-Healing Tools for LinkX Agentic Supervisor."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from app.services.agentic.self_healing_graph import heal_selector
from app.services.browser.diagnostics import detect_page_state
from app.services.browser.manager import BrowserManager
from app.services.browser.tools import (
    get_dom_snippet,
    patch_selector_config,
    validate_selector_candidate,
)

logger = logging.getLogger(__name__)


async def inspect_dom_snippet(
    *,
    user_id: str,
    target_url: str = "https://x.com/home",
    selector: str | None = None,
    max_chars: int = 5000,
) -> dict[str, Any]:
    """Capture a sanitized, token-pruned semantic DOM snippet from live X.com for LLM debugging."""
    manager = BrowserManager(user_id=user_id)
    if not manager.session_exists("x"):
        return {
            "success": False,
            "error": "X session not connected.",
            "dom_snippet": "",
            "page_state": "logged_out",
        }

    try:
        async with manager.get_context("x", headless=True) as context:
            page = context.pages[0] if context.pages else await context.new_page()
            for p in context.pages[1:]:
                await p.close()

            await page.goto(target_url, wait_until="domcontentloaded", timeout=20000)
            page_state = await detect_page_state(page)
            dom = await get_dom_snippet(page, selector=selector, max_chars=max_chars)

            return {
                "success": True,
                "current_url": page.url,
                "page_state": page_state,
                "dom_snippet": dom,
            }
    except Exception as e:
        logger.error(f"Error inspecting DOM: {e}")
        return {
            "success": False,
            "error": str(e),
            "dom_snippet": "",
            "page_state": "error",
        }


async def probe_and_patch_broken_selector(
    *,
    user_id: str,
    selector_key: str,
    candidate_selector: str,
    target_url: str = "https://x.com/home",
    config_path: str | None = None,
) -> dict[str, Any]:
    """Test a candidate CSS/XPath selector on live page; if valid and visible,
    atomically patch the selector JSON config on disk."""
    manager = BrowserManager(user_id=user_id)
    if not manager.session_exists("x"):
        return {
            "success": False,
            "error": "X session not connected.",
            "patched": False,
        }

    cfg_path = config_path or str(
        Path(__file__).parent.parent.parent
        / "browser"
        / "selectors"
        / "x_selectors.json"
    )

    try:
        async with manager.get_context("x", headless=True) as context:
            page = context.pages[0] if context.pages else await context.new_page()
            for p in context.pages[1:]:
                await p.close()

            await page.goto(target_url, wait_until="domcontentloaded", timeout=20000)
            validation = await validate_selector_candidate(
                page, selector=candidate_selector
            )

            if not validation.get("found") or not validation.get("visible"):
                return {
                    "success": False,
                    "error": f"Candidate selector '{candidate_selector}' failed validation: {validation.get('error', 'not visible')}",
                    "validation": validation,
                    "patched": False,
                }

            # Atomically patch config
            patched = patch_selector_config(
                config_path=cfg_path,
                key_path=selector_key,
                new_selector=candidate_selector,
            )

            return {
                "success": patched,
                "patched": patched,
                "selector_key": selector_key,
                "new_selector": candidate_selector,
                "validation": validation,
            }
    except Exception as e:
        logger.error(f"Error testing candidate selector: {e}")
        return {
            "success": False,
            "error": str(e),
            "patched": False,
        }


async def trigger_autonomous_selector_healing(
    *,
    user_id: str,
    failed_selector_key: str,
    target_url: str = "https://x.com/home",
    config_path: str | None = None,
) -> dict[str, Any]:
    """Invoke the LangGraph Self-Healing Supervisor to capture DOM, diagnose with LLM,
    test candidates on live browser, and hot-patch configuration automatically."""
    manager = BrowserManager(user_id=user_id)
    if not manager.session_exists("x"):
        return {
            "success": False,
            "error": "X session not connected.",
            "healed_selector": None,
        }

    cfg_path = config_path or str(
        Path(__file__).parent.parent.parent
        / "browser"
        / "selectors"
        / "x_selectors.json"
    )

    try:
        async with manager.get_context("x", headless=True) as context:
            page = context.pages[0] if context.pages else await context.new_page()
            for p in context.pages[1:]:
                await p.close()

            await page.goto(target_url, wait_until="domcontentloaded", timeout=20000)
            healed = await heal_selector(
                page=page,
                failed_selector_key=failed_selector_key,
                config_path=cfg_path,
            )

            return {
                "success": healed is not None,
                "failed_selector_key": failed_selector_key,
                "healed_selector": healed,
            }
    except Exception as e:
        logger.error(f"Error in autonomous selector healing: {e}")
        return {
            "success": False,
            "error": str(e),
            "healed_selector": None,
        }
