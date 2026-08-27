"""Session diagnosis and recovery helpers for ScrapingGraph."""

from __future__ import annotations

import logging
from typing import Any

from app.services.agentic.session_recovery_graph import (
    _detect_overlay,
    recover_page_session,
)
from app.services.browser.diagnostics import detect_page_state
from app.services.browser.manager import BrowserManager

logger = logging.getLogger(__name__)


def _verify_session_exists(*, user_id: str) -> tuple[bool, str | None]:
    """Verify if user has stored session credentials."""
    try:
        manager = BrowserManager(user_id=user_id)
        if not manager.session_exists("x"):
            return False, "No stored X.com session found"
        return True, None
    except Exception as e:
        logger.warning(f"BrowserManager session check error: {e}")
        return False, f"Failed checking session: {e}"


async def _diagnose_and_recover_overlay(
    *, page: Any, mouse: Any | None = None
) -> tuple[str, str, dict[str, Any] | None, str | None]:
    """Recover session when overlays or transient errors are diagnosed."""
    try:
        recovery = await recover_page_session(
            page=page, expected_state="home", mouse=mouse
        )
        rec_dict = recovery.model_dump() if hasattr(recovery, "model_dump") else {}
        if not getattr(recovery, "recovered", False):
            err = (
                getattr(recovery, "error", None)
                or f"Session recovery failed: {getattr(recovery, 'status', 'failed')}"
            )
            return (
                getattr(recovery, "page_state", "error"),
                "unrecoverable",
                rec_dict,
                err,
            )
        return "ok", "session_ready", rec_dict, None
    except Exception as rec_err:
        logger.warning(f"Exception during session recovery: {rec_err}")
        return (
            "error",
            "unrecoverable",
            {"recovered": False, "error": str(rec_err)},
            f"Session recovery encountered exception: {rec_err}",
        )


async def _diagnose_page_health(*, page: Any) -> tuple[str, bool]:
    """Diagnose page state and check for overlays safely."""
    try:
        page_state = await detect_page_state(page)
    except Exception as e:
        logger.warning(f"Failed to detect page state: {e}")
        page_state = "error"

    has_overlay = False
    try:
        has_overlay = bool(await _detect_overlay(page=page))
    except Exception as overlay_err:
        logger.debug(f"Overlay check error: {overlay_err}")

    return page_state, has_overlay


def _is_valid_page(*, page: Any) -> bool:
    """Check if page object is a valid Playwright page instance."""
    return page is not None and (hasattr(page, "goto") or hasattr(page, "locator"))


def _validate_user_session(*, user_id: str) -> tuple[str, str, None, str | None] | None:
    """Check if user session credentials exist on disk."""
    has_session, session_err = _verify_session_exists(user_id=user_id)
    if not has_session:
        state = "logged_out" if "No stored" in (session_err or "") else "error"
        return state, "unrecoverable", None, session_err
    return None


async def _check_session_and_page_state(
    *,
    user_id: str,
    page: Any,
    mouse: Any | None = None,
) -> tuple[str, str, dict[str, Any] | None, str | None]:
    """Check browser session existence, diagnose sentinel state, and auto-recover overlays."""
    if not _is_valid_page(page=page):
        return (
            "error",
            "unrecoverable",
            None,
            "No active browser page instance provided in state",
        )

    session_abort = _validate_user_session(user_id=user_id)
    if session_abort:
        return session_abort

    page_state, has_overlay = await _diagnose_page_health(page=page)
    if page_state in ("logged_out", "captcha"):
        return page_state, "unrecoverable", None, f"Unrecoverable state: {page_state}"

    if page_state != "ok" or has_overlay:
        return await _diagnose_and_recover_overlay(page=page, mouse=mouse)

    return "ok", "session_ready", None, None
