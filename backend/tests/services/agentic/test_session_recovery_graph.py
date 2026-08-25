"""Unit and integration tests for SessionRecoveryGraph (Issue #97)."""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from langgraph.graph import END

from app.services.agentic.schemas import SessionRecoveryReport
from app.services.agentic.session_recovery_graph import (
    DEFAULT_OVERLAY_SELECTORS,
    SessionRecoveryState,
    _route_after_diagnosis,
    _route_after_dismissal,
    attempt_dismissal_node,
    build_session_recovery_graph,
    diagnose_page_state_node,
    recover_page_session,
    reverify_page_state_node,
)


class MockPlaywrightPage:
    """Simulates Playwright Page behavior for SessionRecoveryGraph testing."""

    def __init__(
        self,
        *,
        url: str = "https://x.com/home",
        title: str = "Home / X",
        initial_visible_selectors: list[str] | None = None,
        clear_on_action: bool = True,
    ) -> None:
        self.url = url
        self._title = title
        self.visible_selectors = set(initial_visible_selectors or [])
        self.clear_on_action = clear_on_action
        self.click_exception: Exception | None = None
        self.reload_exception: Exception | None = None
        self.clicked_selectors: list[str] = []
        self.reloaded = False
        self.keyboard = AsyncMock()
        self.keyboard.press = AsyncMock(side_effect=self._press_key)

    async def title(self) -> str:
        return self._title

    async def _press_key(self, key: str) -> None:
        if self.clear_on_action:
            self.visible_selectors.clear()

    async def reload(self, *args: Any, **kwargs: Any) -> None:
        self.reloaded = True
        if self.reload_exception:
            raise self.reload_exception
        if self.clear_on_action:
            self.visible_selectors.clear()

    def locator(self, selector: str) -> Any:
        loc = AsyncMock()
        is_visible = any(
            v == selector or v in selector or selector in v
            for v in self.visible_selectors
        )
        loc.count = AsyncMock(return_value=1 if is_visible else 0)
        loc.is_visible = AsyncMock(return_value=is_visible)
        loc.all = AsyncMock(return_value=[loc] if is_visible else [])
        loc.first = loc

        async def _click(*_args: Any, **_kwargs: Any) -> None:
            self.clicked_selectors.append(selector)
            if self.click_exception:
                raise self.click_exception
            if self.clear_on_action:
                self.visible_selectors.clear()

        loc.click = AsyncMock(side_effect=_click)
        return loc


# --- Slice 1: Clean Page ---


@pytest.mark.anyio
async def test_slice_1_clean_page_healthy() -> None:
    """Slice 1: Clean page -> instant recovered=True, 0 actions."""
    page = MockPlaywrightPage(
        url="https://x.com/home",
        title="Home / X",
        initial_visible_selectors=[],
    )

    report = await recover_page_session(page=page)

    assert isinstance(report, SessionRecoveryReport)
    assert report.recovered is True
    assert report.page_state == "ok"
    assert report.overlay_type is None
    assert report.dismiss_attempted is False
    assert report.recovery_action is None
    assert report.status == "healthy"
    assert report.error is None
    assert len(page.clicked_selectors) == 0
    assert page.reloaded is False


# --- Slices 2-5: Parametrized Overlay Recovery Verification ---


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("overlay_selector", "expected_overlay", "expected_action"),
    [
        (
            DEFAULT_OVERLAY_SELECTORS["not_now_button"],
            "notification_prompt",
            "click_not_now",
        ),
        (
            DEFAULT_OVERLAY_SELECTORS["app_bar_close"],
            "premium_upsell",
            "click_close",
        ),
        (
            DEFAULT_OVERLAY_SELECTORS["bottom_bar"],
            "cookie_consent",
            "click_dismiss",
        ),
        (
            DEFAULT_OVERLAY_SELECTORS["dismiss_button"],
            "cookie_consent",
            "click_dismiss",
        ),
        (
            "text=Something went wrong",
            "error_banner",
            "soft_reload",
        ),
    ],
)
async def test_slices_overlay_recovery_success(
    overlay_selector: str,
    expected_overlay: str,
    expected_action: str,
) -> None:
    """Slices 2-5: Verify all standard overlays are diagnosed, dismissed, and recovered."""
    page = MockPlaywrightPage(
        initial_visible_selectors=[overlay_selector],
        clear_on_action=True,
    )

    report = await recover_page_session(page=page)

    assert report.recovered is True
    assert report.page_state == "ok"
    assert report.overlay_type == expected_overlay
    assert report.dismiss_attempted is True
    assert report.recovery_action == expected_action
    assert report.status == "recovered"
    assert report.error is None


# --- Slice 6: Auth Redirect ---


@pytest.mark.anyio
@pytest.mark.parametrize(
    "login_url",
    [
        "https://x.com/login",
        "https://x.com/i/flow/login",
    ],
)
async def test_slice_6_auth_redirect_abort(login_url: str) -> None:
    """Slice 6: Auth redirect ('logged_out') -> immediate abort recovered=False."""
    page = MockPlaywrightPage(
        url=login_url,
        title="Log in to X / X",
        initial_visible_selectors=[],
    )

    report = await recover_page_session(page=page)

    assert report.recovered is False
    assert report.page_state == "logged_out"
    assert report.overlay_type == "auth_redirect"
    assert report.dismiss_attempted is False
    assert report.recovery_action is None
    assert report.status == "unrecoverable"
    assert len(page.clicked_selectors) == 0
    assert page.reloaded is False


# --- Slice 7: CAPTCHA Challenge ---


@pytest.mark.anyio
@pytest.mark.parametrize(
    "captcha_title,captcha_selector",
    [
        ("Just a moment...", None),
        ("Attention Required! | Cloudflare", None),
        ("Security Check", None),
        ("X / Challenge", "#challenge-running"),
    ],
)
async def test_slice_7_captcha_challenge_abort(
    captcha_title: str, captcha_selector: str | None
) -> None:
    """Slice 7: CAPTCHA challenge ('captcha') -> immediate abort recovered=False."""
    visible = [captcha_selector] if captcha_selector else []
    page = MockPlaywrightPage(
        url="https://x.com/account/access",
        title=captcha_title,
        initial_visible_selectors=visible,
    )

    report = await recover_page_session(page=page)

    assert report.recovered is False
    assert report.page_state == "captcha"
    assert report.overlay_type == "captcha"
    assert report.dismiss_attempted is False
    assert report.recovery_action is None
    assert report.status == "unrecoverable"
    assert len(page.clicked_selectors) == 0
    assert page.reloaded is False


# --- Slice 8: Dismissal Click Exception ---


@pytest.mark.anyio
async def test_slice_8_dismissal_click_throws_exception() -> None:
    """Slice 8: Dismissal click throws exception -> handles cleanly, reverifies."""
    page = MockPlaywrightPage(
        initial_visible_selectors=[DEFAULT_OVERLAY_SELECTORS["not_now_button"]],
        clear_on_action=False,
    )
    page.click_exception = RuntimeError("Element not interactable or obscured")

    report = await recover_page_session(page=page)

    assert report.recovered is False
    assert report.dismiss_attempted is True
    assert report.recovery_action == "click_not_now"
    assert report.status == "unrecovered"


# --- Slice 9: Soft Reload Fails to Recover ---


@pytest.mark.anyio
async def test_slice_9_soft_reload_fails_to_recover() -> None:
    """Slice 9: Soft reload fails to recover -> terminates with recovered=False."""
    page = MockPlaywrightPage(
        initial_visible_selectors=["text=Something went wrong"],
        clear_on_action=False,
    )

    report = await recover_page_session(page=page)

    assert report.recovered is False
    assert report.overlay_type == "error_banner"
    assert report.dismiss_attempted is True
    assert report.recovery_action == "soft_reload"
    assert report.status == "unrecovered"
    assert page.reloaded is True


# --- Node-level Unit Tests ---


@pytest.mark.anyio
async def test_diagnose_page_state_node_missing_page() -> None:
    """diagnose_page_state_node handles missing page gracefully."""
    state: SessionRecoveryState = {"page": None}
    res = await diagnose_page_state_node(state)
    assert res["page_state"] == "error"
    assert res["recovered"] is False
    assert res["status"] == "failed"


@pytest.mark.anyio
async def test_attempt_dismissal_node_missing_page() -> None:
    """attempt_dismissal_node handles missing page gracefully."""
    state: SessionRecoveryState = {"page": None, "overlay_type": "notification_prompt"}
    res = await attempt_dismissal_node(state)
    assert res["dismiss_attempted"] is True
    assert res["status"] == "dismiss_failed"


@pytest.mark.anyio
async def test_reverify_page_state_node_missing_page() -> None:
    """reverify_page_state_node handles missing page gracefully."""
    state: SessionRecoveryState = {"page": None}
    res = await reverify_page_state_node(state)
    assert res["recovered"] is False
    assert res["status"] == "failed"


def test_routing_functions() -> None:
    """Verify routing decisions for all states."""
    # Healthy -> END
    assert _route_after_diagnosis({"recovered": True, "page_state": "ok"}) == END

    # Unrecoverable states -> END
    assert (
        _route_after_diagnosis({"recovered": False, "page_state": "logged_out"}) == END
    )
    assert _route_after_diagnosis({"recovered": False, "page_state": "captcha"}) == END
    assert (
        _route_after_diagnosis({"recovered": False, "overlay_type": "auth_redirect"})
        == END
    )
    assert (
        _route_after_diagnosis({"recovered": False, "overlay_type": "captcha"}) == END
    )

    # Overlay diagnosed -> attempt_dismissal
    assert (
        _route_after_diagnosis(
            {
                "recovered": False,
                "page_state": "modal_overlay",
                "overlay_type": "notification_prompt",
            }
        )
        == "attempt_dismissal"
    )

    # After dismissal -> reverify_page_state
    assert _route_after_dismissal({}) == "reverify_page_state"


def test_build_session_recovery_graph_compiles() -> None:
    """build_session_recovery_graph returns a compiled LangGraph instance."""
    graph = build_session_recovery_graph()
    assert graph is not None


@pytest.mark.anyio
async def test_recover_page_session_timeout_handling() -> None:
    """recover_page_session gracefully handles execution timeouts."""
    import asyncio

    page = MockPlaywrightPage(
        initial_visible_selectors=[DEFAULT_OVERLAY_SELECTORS["not_now_button"]],
    )

    async def hanging_detect(_p: Any) -> str:
        await asyncio.sleep(1.0)
        return "ok"

    from unittest.mock import patch

    with patch(
        "app.services.agentic.session_recovery_graph.detect_page_state",
        side_effect=hanging_detect,
    ):
        report = await recover_page_session(page=page, timeout_ms=50)

        assert report.recovered is False
        assert report.page_state == "error"
        assert report.status == "failed"
