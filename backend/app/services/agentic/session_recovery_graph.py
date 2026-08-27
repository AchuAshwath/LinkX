"""LangGraph StateGraph for diagnosing and recovering browser sessions from modal overlays."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.services.agentic.schemas import SessionRecoveryReport
from app.services.browser.actions import EvasionMouse, random_delay
from app.services.browser.diagnostics import detect_page_state

logger = logging.getLogger(__name__)

DEFAULT_OVERLAY_SELECTORS: dict[str, str] = {
    "sheet_dialog": '[data-testid="sheetDialog"]',
    "app_bar_close": '[data-testid="app-bar-close"]',
    "bottom_bar": '[data-testid="BottomBar"]',
    "not_now_button": (
        '[role="button"]:has-text("Not now"), '
        'button:has-text("Not now"), '
        '[role="button"]:has-text("Maybe later"), '
        'button:has-text("Maybe later")'
    ),
    "dismiss_button": (
        '[role="button"]:has-text("Dismiss"), '
        'button:has-text("Dismiss"), '
        '[role="button"]:has-text("Close"), '
        'button:has-text("Close")'
    ),
}


class SessionRecoveryState(TypedDict, total=False):
    page: Any
    mouse: Any
    expected_state: str
    page_state: str
    overlay_type: str | None
    dismiss_attempted: bool
    recovery_action: str | None
    recovered: bool
    status: str
    error: str | None


async def _is_locator_visible(
    *, page: Any, selector: str, timeout_ms: int = 1500
) -> bool:
    """Check if an element matching selector is present and visible on page."""
    try:
        if not hasattr(page, "locator"):
            return False
        loc = page.locator(selector)
        count = await loc.count() if hasattr(loc, "count") else 0
        if count == 0:
            return False
        target = getattr(loc, "first", loc)
        if hasattr(target, "is_visible"):
            try:
                return bool(await target.is_visible(timeout=timeout_ms))
            except TypeError:
                return bool(await target.is_visible())
        return count > 0
    except Exception:
        return False


async def _detect_overlay(*, page: Any) -> str | None:
    """Inspect page DOM for known overlays and blocking UI modals."""
    try:
        # 1. Notification prompt (sheetDialog with not_now or not_now_button visible)
        if await _is_locator_visible(
            page=page, selector=DEFAULT_OVERLAY_SELECTORS["not_now_button"]
        ):
            return "notification_prompt"

        # 2. Premium upsell (sheetDialog or app_bar_close visible)
        if await _is_locator_visible(
            page=page, selector=DEFAULT_OVERLAY_SELECTORS["app_bar_close"]
        ):
            return "premium_upsell"

        # 3. Cookie consent banner / bottom bar
        if await _is_locator_visible(
            page=page, selector=DEFAULT_OVERLAY_SELECTORS["bottom_bar"]
        ):
            return "cookie_consent"
        if await _is_locator_visible(
            page=page, selector=DEFAULT_OVERLAY_SELECTORS["dismiss_button"]
        ):
            return "cookie_consent"

        # 4. In-page error banner
        for err_sel in (
            "text=Something went wrong",
            "text=Try again",
            "[data-testid='error-detail']",
        ):
            if await _is_locator_visible(page=page, selector=err_sel):
                return "error_banner"

        return None
    except Exception as e:
        logger.debug(f"Error inspecting page for overlays: {e}")
        return None


async def _safe_click(*, page: Any, selector: str, timeout_ms: int = 3000) -> bool:
    """Click the first matching locator safely."""
    try:
        loc = page.locator(selector)
        count = await loc.count() if hasattr(loc, "count") else 0
        if count > 0:
            await loc.first.click(timeout=timeout_ms)
            return True
    except Exception as e:
        logger.debug(f"Safe click failed on {selector}: {e}")
    return False


async def _stealth_click(
    *,
    page: Any,
    selector: str,
    mouse: Any | None = None,
    timeout_ms: int = 3000,
) -> bool:
    """Click element using EvasionMouse Bezier trajectory if available, falling back to safe click."""
    if mouse is not None and hasattr(mouse, "human_click"):
        try:
            await mouse.human_click(selector=selector)
            return True
        except Exception as mouse_err:
            logger.debug(
                f"EvasionMouse click failed on {selector}, using fallback: {mouse_err}"
            )

    return await _safe_click(page=page, selector=selector, timeout_ms=timeout_ms)


def _is_valid_page(page: Any) -> bool:
    """Check if page object has basic Playwright attributes."""
    if page is None:
        return False
    return hasattr(page, "locator") or hasattr(page, "url") or hasattr(page, "title")


def _classify_sentinel_state(page_state: str) -> dict[str, Any] | None:
    """Map unrecoverable or error sentinel states."""
    if page_state == "logged_out":
        return {
            "page_state": "logged_out",
            "overlay_type": "auth_redirect",
            "recovered": False,
            "status": "unrecoverable",
        }
    if page_state == "captcha":
        return {
            "page_state": "captcha",
            "overlay_type": "captcha",
            "recovered": False,
            "status": "unrecoverable",
        }
    if page_state in ("rate_limited", "error"):
        return {
            "page_state": page_state,
            "overlay_type": "error_banner",
            "recovered": False,
            "status": "diagnosed",
        }
    return None


def _resolve_diagnose_mouse(*, page: Any, state_mouse: Any) -> Any:
    """Resolve or construct EvasionMouse instance from page."""
    if state_mouse is not None:
        return state_mouse
    if hasattr(page, "mouse") and hasattr(page, "viewport_size"):
        try:
            return EvasionMouse(page)
        except Exception as m_err:
            logger.debug(f"Could not initialize EvasionMouse in diagnose node: {m_err}")
    return None


async def diagnose_page_state_node(state: SessionRecoveryState) -> dict[str, Any]:
    """Diagnose page sentinel state and inspect for known modal overlays."""
    page = state.get("page")
    if not _is_valid_page(page):
        return {
            "page_state": "error",
            "overlay_type": None,
            "recovered": False,
            "status": "failed",
            "error": "Invalid or missing page instance provided in state",
        }

    mouse = _resolve_diagnose_mouse(page=page, state_mouse=state.get("mouse"))

    try:
        page_state = await detect_page_state(page)
    except Exception as e:
        logger.warning(f"Page state detection failed: {e}")
        page_state = "error"

    sentinel_result = _classify_sentinel_state(page_state)
    if sentinel_result is not None:
        sentinel_result["mouse"] = mouse
        return sentinel_result

    # Inspect for active modal overlays
    overlay = await _detect_overlay(page=page)
    if overlay:
        return {
            "mouse": mouse,
            "page_state": ("modal_overlay" if overlay != "error_banner" else "error"),
            "overlay_type": overlay,
            "recovered": False,
            "status": "diagnosed",
        }

    # Clean, healthy page
    return {
        "mouse": mouse,
        "page_state": "ok",
        "overlay_type": None,
        "recovered": True,
        "status": "healthy",
    }


async def _press_escape_fallback(*, page: Any) -> None:
    """Press Escape key safely as a modal dismissal fallback."""
    if hasattr(page, "keyboard"):
        await random_delay(min_sec=0.2, max_sec=0.5)
        await page.keyboard.press("Escape")


async def _dismiss_notification_prompt(*, page: Any, mouse: Any | None = None) -> str:
    clicked = await _stealth_click(
        page=page,
        selector=DEFAULT_OVERLAY_SELECTORS["not_now_button"],
        mouse=mouse,
    )
    if not clicked:
        await _press_escape_fallback(page=page)
    return "click_not_now"


async def _dismiss_premium_upsell(*, page: Any, mouse: Any | None = None) -> str:
    clicked = await _stealth_click(
        page=page,
        selector=DEFAULT_OVERLAY_SELECTORS["app_bar_close"],
        mouse=mouse,
    )
    if not clicked:
        await _press_escape_fallback(page=page)
        return "press_escape"
    return "click_close"


async def _dismiss_cookie_consent(*, page: Any, mouse: Any | None = None) -> str:
    clicked = await _stealth_click(
        page=page,
        selector=DEFAULT_OVERLAY_SELECTORS["dismiss_button"],
        mouse=mouse,
    )
    if not clicked:
        bottom_bar_btn = (
            f"{DEFAULT_OVERLAY_SELECTORS['bottom_bar']} button, "
            f"{DEFAULT_OVERLAY_SELECTORS['bottom_bar']} [role='button']"
        )
        await _stealth_click(page=page, selector=bottom_bar_btn, mouse=mouse)
    return "click_dismiss"


async def _reload_error_banner(*, page: Any, mouse: Any | None = None) -> str:  # noqa: ARG001
    if hasattr(page, "reload"):
        await page.reload(wait_until="domcontentloaded", timeout=15000)
        await random_delay(min_sec=0.5, max_sec=1.5)
    return "soft_reload"


async def _dismiss_fallback(*, page: Any, mouse: Any | None = None) -> str:  # noqa: ARG001
    if hasattr(page, "keyboard"):
        await _press_escape_fallback(page=page)
        return "press_escape"
    return "none"


DISMISSAL_DISPATCH: dict[str, Any] = {
    "notification_prompt": _dismiss_notification_prompt,
    "premium_upsell": _dismiss_premium_upsell,
    "cookie_consent": _dismiss_cookie_consent,
    "error_banner": _reload_error_banner,
}


async def _execute_dismissal_action(
    *, page: Any, overlay_type: str | None, mouse: Any | None = None
) -> str | None:
    """Execute specialized dismissal handler for diagnosed overlay type."""
    if overlay_type in ("auth_redirect", "captcha"):
        return None
    handler = DISMISSAL_DISPATCH.get(overlay_type or "", _dismiss_fallback)
    return str(await handler(page=page, mouse=mouse))


async def attempt_dismissal_node(state: SessionRecoveryState) -> dict[str, Any]:
    """Dispatch targeted dismissal action based on diagnosed overlay type."""
    page = state.get("page")
    overlay_type = state.get("overlay_type")
    mouse = state.get("mouse")

    if page is None:
        return {
            "dismiss_attempted": True,
            "recovery_action": None,
            "status": "dismiss_failed",
            "error": "No page instance available for dismissal",
        }

    try:
        action = await _execute_dismissal_action(
            page=page, overlay_type=overlay_type, mouse=mouse
        )
        return {
            "dismiss_attempted": True,
            "recovery_action": action,
            "status": "dismissed",
            "error": None,
        }
    except Exception as e:
        logger.warning(f"Dismissal action failed for '{overlay_type}': {e}")
        return {
            "dismiss_attempted": True,
            "recovery_action": None,
            "status": "dismissed",
            "error": str(e),
        }


async def reverify_page_state_node(state: SessionRecoveryState) -> dict[str, Any]:
    """Reverify that page state returned to 'ok' and no overlays remain."""
    page = state.get("page")
    if page is None:
        return {
            "recovered": False,
            "page_state": "error",
            "status": "failed",
            "error": "No page instance available for reverification",
        }

    try:
        page_state = await detect_page_state(page)
        overlay = await _detect_overlay(page=page)

        if page_state == "ok" and overlay is None:
            return {
                "page_state": "ok",
                "recovered": True,
                "status": "recovered",
            }

        return {
            "page_state": page_state if page_state != "ok" else "modal_overlay",
            "overlay_type": overlay or state.get("overlay_type"),
            "recovered": False,
            "status": "unrecovered",
        }
    except Exception as e:
        logger.error(f"Reverification error: {e}")
        return {
            "recovered": False,
            "page_state": "error",
            "status": "reverify_failed",
            "error": str(e),
        }


def _route_after_diagnosis(state: SessionRecoveryState) -> str:
    """Route after initial diagnosis: end if healthy/unrecoverable, else dismiss."""
    if state.get("recovered") is True:
        return END

    page_state = state.get("page_state", "")
    overlay_type = state.get("overlay_type")

    if page_state in ("logged_out", "captcha") or overlay_type in (
        "auth_redirect",
        "captcha",
    ):
        return END

    if state.get("status") in ("unrecoverable", "failed") and not overlay_type:
        return END

    return "attempt_dismissal"


def _route_after_dismissal(_state: SessionRecoveryState) -> str:
    """Route after dismissal attempt: always proceed to reverification."""
    return "reverify_page_state"


def build_session_recovery_graph() -> Any:
    """Compile LangGraph StateGraph for session recovery and overlay clearing."""
    builder = StateGraph(SessionRecoveryState)

    builder.add_node("diagnose_page_state", diagnose_page_state_node)
    builder.add_node("attempt_dismissal", attempt_dismissal_node)
    builder.add_node("reverify_page_state", reverify_page_state_node)

    builder.add_edge(START, "diagnose_page_state")
    builder.add_conditional_edges("diagnose_page_state", _route_after_diagnosis)
    builder.add_conditional_edges("attempt_dismissal", _route_after_dismissal)
    builder.add_edge("reverify_page_state", END)

    return builder.compile()


_session_recovery_graph = build_session_recovery_graph()


async def recover_page_session(
    *,
    page: Any,
    expected_state: str = "home",
    timeout_ms: int = 5000,
    mouse: Any | None = None,
) -> SessionRecoveryReport:
    """Execute session recovery workflow on a Playwright page."""
    initial_state: SessionRecoveryState = {
        "page": page,
        "mouse": mouse,
        "expected_state": expected_state,
        "page_state": "unknown",
        "overlay_type": None,
        "dismiss_attempted": False,
        "recovery_action": None,
        "recovered": False,
        "status": "pending",
        "error": None,
    }

    try:
        final_state = await asyncio.wait_for(
            _session_recovery_graph.ainvoke(initial_state),
            timeout=timeout_ms / 1000.0,
        )
        return SessionRecoveryReport(
            recovered=final_state.get("recovered", False),
            page_state=final_state.get("page_state", "unknown"),
            overlay_type=final_state.get("overlay_type"),
            dismiss_attempted=final_state.get("dismiss_attempted", False),
            recovery_action=final_state.get("recovery_action"),
            status=final_state.get("status", "completed"),
            error=final_state.get("error"),
        )
    except (asyncio.TimeoutError, TimeoutError):
        logger.warning(f"Session recovery timed out after {timeout_ms}ms")
        return SessionRecoveryReport(
            recovered=False,
            page_state="error",
            overlay_type=None,
            dismiss_attempted=False,
            recovery_action=None,
            status="timeout",
            error=f"Session recovery timed out after {timeout_ms}ms",
        )
    except Exception as e:
        logger.error(f"Session recovery workflow failed: {e}")
        return SessionRecoveryReport(
            recovered=False,
            page_state="error",
            overlay_type=None,
            dismiss_attempted=False,
            recovery_action=None,
            status="failed",
            error=str(e),
        )
