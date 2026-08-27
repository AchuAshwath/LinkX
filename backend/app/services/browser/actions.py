"""Humanized interactions for Playwright browser automation."""

from __future__ import annotations

import asyncio
import logging
import math
import random
import string
from typing import TYPE_CHECKING, Any

from humantyping.integration import HumanTyper  # type: ignore
from playwright.async_api import TimeoutError as PlaywrightTimeoutError


class PostButtonDisabledError(Exception):
    """Raised when a button remains in an unclickable/disabled state."""

    pass


if TYPE_CHECKING:
    from rebrowser_playwright.async_api import Page

logger = logging.getLogger(__name__)

__all__ = [
    "HumanTyper",
    "EvasionMouse",
    "PostButtonDisabledError",
    "random_delay",
    "normalize_post_text",
    "human_navigation",
    "install_visual_cursor",
]

VISUAL_CURSOR_SCRIPT = """
(() => {
    if (window.__playwright_cursor_installed) return;
    window.__playwright_cursor_installed = true;

    function createCursor() {
        if (document.getElementById('playwright-mouse-pointer')) return;
        const cursor = document.createElement('div');
        cursor.id = 'playwright-mouse-pointer';
        cursor.style.position = 'fixed';
        cursor.style.top = '0px';
        cursor.style.left = '0px';
        cursor.style.width = '24px';
        cursor.style.height = '24px';
        cursor.style.border = '2px solid #FF4500';
        cursor.style.borderRadius = '50%';
        cursor.style.backgroundColor = 'rgba(255, 69, 0, 0.4)';
        cursor.style.boxShadow = '0 0 14px rgba(255, 69, 0, 0.9)';
        cursor.style.pointerEvents = 'none';
        cursor.style.zIndex = '2147483647';
        cursor.style.transition = 'transform 0.08s ease-out, background-color 0.15s ease';
        cursor.style.transform = 'translate(-50%, -50%)';

        const dot = document.createElement('div');
        dot.style.position = 'absolute';
        dot.style.top = '50%';
        dot.style.left = '50%';
        dot.style.width = '6px';
        dot.style.height = '6px';
        dot.style.borderRadius = '50%';
        dot.style.backgroundColor = '#FFFFFF';
        dot.style.transform = 'translate(-50%, -50%)';
        cursor.appendChild(dot);

        (document.body || document.documentElement).appendChild(cursor);

        window.addEventListener('mousemove', (event) => {
            cursor.style.left = `${event.clientX}px`;
            cursor.style.top = `${event.clientY}px`;
        }, true);

        window.addEventListener('mousedown', () => {
            cursor.style.backgroundColor = 'rgba(255, 0, 0, 0.9)';
            cursor.style.transform = 'translate(-50%, -50%) scale(0.6)';
        }, true);

        window.addEventListener('mouseup', () => {
            cursor.style.backgroundColor = 'rgba(255, 69, 0, 0.4)';
            cursor.style.transform = 'translate(-50%, -50%) scale(1.0)';
        }, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createCursor);
    } else {
        createCursor();
    }
})();
"""


async def install_visual_cursor(page: Any) -> None:
    """Inject an on-screen glowing cursor indicator so observers can visibly track Playwright mouse actions."""
    try:
        if hasattr(page, "add_init_script"):
            await page.add_init_script(VISUAL_CURSOR_SCRIPT)
        if hasattr(page, "evaluate"):
            await page.evaluate(VISUAL_CURSOR_SCRIPT)
    except Exception as e:
        logger.debug(f"Could not install visual cursor: {e}")


async def random_delay(*, min_sec: float = 0.5, max_sec: float = 2.0) -> None:
    """Pause execution for a random duration between min_sec and max_sec."""
    delay = random.uniform(min_sec, max_sec)
    await asyncio.sleep(delay)


def normalize_post_text(text: str) -> str:
    """Sanitize and normalize text for humantyping and social media platforms.

    1. Removes emojis and non-ascii characters that crash the Playwright/humantyping QWERTY mapping.
    2. Ensures the text ends with a space to dismiss any hashtag/mention suggestion overlays.
    """
    # Sanitize text for humantyping
    sanitized = "".join(c for c in text if c in string.printable or c.isascii())

    # Always append a space at the end to dismiss dropdown overlays
    if not sanitized.endswith(" "):
        sanitized += " "

    return sanitized


def _cubic_bezier(t: float, p0: float, p1: float, p2: float, p3: float) -> float:
    """Calculate a point on a cubic Bezier curve."""
    return (
        (1 - t) ** 3 * p0
        + 3 * (1 - t) ** 2 * t * p1
        + 3 * (1 - t) * t**2 * p2
        + t**3 * p3
    )


class EvasionMouse:
    """Stateful mouse tracker that simulates persistent human movements and idle wiggles."""

    def __init__(self, page: Page):
        self.page = page
        self.lock = asyncio.Lock()

        # Determine dynamic viewport boundaries
        viewport = getattr(page, "viewport_size", None)
        self._max_x = float(viewport["width"]) if viewport else 1200.0
        self._max_y = float(viewport["height"]) if viewport else 700.0

        # Start at a random "natural" position within the dynamic viewport
        self.x = random.uniform(self._max_x * 0.2, self._max_x * 0.8)
        self.y = random.uniform(self._max_y * 0.2, self._max_y * 0.8)

        self._idle_task: asyncio.Task[None] | None = None
        self._is_idling = False

    async def start_idle(self) -> None:
        """Start background task to wiggle mouse randomly while waiting (sitting duck)."""
        await install_visual_cursor(self.page)
        if self._idle_task is not None:
            return
        self._is_idling = True
        self._idle_task = asyncio.create_task(self._idle_loop())

    async def stop_idle(self) -> None:
        """Stop background wiggling."""
        self._is_idling = False
        if self._idle_task:
            self._idle_task.cancel()
            try:
                await self._idle_task
            except asyncio.CancelledError:
                pass
            self._idle_task = None

    async def _idle_loop(self) -> None:
        """Background loop for subtle natural idle wiggles while reading/waiting."""
        while self._is_idling:
            # Wait 2-5 seconds between idle wiggles
            await asyncio.sleep(random.uniform(2.0, 5.0))

            # Wiggle randomly by 10-50 pixels to simulate reading/fidgeting
            target_x = self.x + random.uniform(-50, 50)
            target_y = self.y + random.uniform(-50, 50)

            target_x = max(5.0, min(self._max_x - 5.0, target_x))
            target_y = max(5.0, min(self._max_y - 5.0, target_y))

            try:
                async with self.lock:
                    await self._move_mouse_internal(
                        target_x, target_y, steps=random.randint(15, 30)
                    )
            except Exception as e:
                logger.debug("Idle loop caught exception, stopping: %s", e)
                self._is_idling = False
                break

    async def _move_mouse_internal(
        self, target_x: float, target_y: float, steps: int = 20
    ) -> None:
        """Optimized natural human trajectory using direct vector interpolation and subtle hand curvature."""
        start_x, start_y = self.x, self.y
        dx = target_x - start_x
        dy = target_y - start_y
        dist = math.hypot(dx, dy)
        if dist < 1.0:
            return

        # Unit normal vector perpendicular to direct motion line
        nx = -dy / dist
        ny = dx / dist

        # Subtle natural hand arc (maximum 4-7% curvature)
        arc = random.uniform(-0.06, 0.06) * dist

        cp1_x = start_x + (0.35 * dx) + (arc * nx)
        cp1_y = start_y + (0.35 * dy) + (arc * ny)
        cp2_x = start_x + (0.70 * dx) + (0.65 * arc * nx)
        cp2_y = start_y + (0.70 * dy) + (0.65 * arc * ny)

        actual_steps = max(12, min(steps, 40))
        for i in range(1, actual_steps + 1):
            raw_t = i / actual_steps
            # Cosine ease-in / ease-out
            t = (1 - math.cos(math.pi * raw_t)) / 2

            step_x = _cubic_bezier(t, start_x, cp1_x, cp2_x, target_x)
            step_y = _cubic_bezier(t, start_y, cp1_y, cp2_y, target_y)

            # Tiny sub-pixel human jitter (0.3px)
            step_x += random.uniform(-0.4, 0.4)
            step_y += random.uniform(-0.4, 0.4)

            await self.page.mouse.move(step_x, step_y)
            await asyncio.sleep(random.uniform(0.008, 0.018))

        await self.page.mouse.move(target_x, target_y)
        self.x = target_x
        self.y = target_y

    async def human_click(
        self,
        *,
        selector: str | None = None,
        locator: Any | None = None,
    ) -> None:
        """Click an element using a smooth Bezier path."""
        # Pause idle task to claim exclusive mouse control
        await self.stop_idle()

        try:
            async with self.lock:
                target_loc = locator
                if target_loc is None and selector:
                    await self.page.wait_for_selector(
                        f"{selector} >> visible=true", timeout=5000
                    )
                    target_loc = self.page.locator(f"{selector} >> visible=true").first

                if target_loc is None:
                    return

                await target_loc.scroll_into_view_if_needed()
                box = await target_loc.bounding_box()

                if not box:
                    logger.warning(
                        "human_click: bounding_box for target is None! Falling back to instant click()."
                    )
                    await target_loc.click()
                    return

                # Pick a random point inside the bounding box
                target_x = box["x"] + (box["width"] * random.uniform(0.2, 0.8))
                target_y = box["y"] + (box["height"] * random.uniform(0.2, 0.8))

                dist = math.hypot(target_x - self.x, target_y - self.y)
                steps = max(20, min(60, int(dist / 10)))

                await self._move_mouse_internal(target_x, target_y, steps)

                await random_delay(min_sec=0.15, max_sec=0.35)

                try:
                    await target_loc.click(
                        position={"x": target_x - box["x"], "y": target_y - box["y"]},
                        delay=random.randint(60, 160),
                        timeout=5000,
                    )
                except PlaywrightTimeoutError as e:
                    logger.error(
                        "human_click: Timeout clicking target. Button might be permanently disabled."
                    )
                    raise PostButtonDisabledError(
                        "Button remained disabled for 5 seconds."
                    ) from e

        finally:
            await self.start_idle()

    async def human_type(self, *, selector: str, text: str, wpm: float = 90.0) -> None:
        """Type text into a field with realistic human behavior using humantyping."""
        # Normalize text to strip emojis and handle hashtag overlays safely
        original_text = text
        text = normalize_post_text(text)
        if text.strip() != original_text.strip():
            logger.info(
                "human_type: Normalized text to remove emojis/non-ascii characters."
            )

        await self.human_click(selector=selector)
        await random_delay(min_sec=0.2, max_sec=0.5)

        # HumanTyper inherently handles IKI log-normal distribution,
        # Markov chain fatigue states, and QWERTY neighbor mistakes.
        typer = HumanTyper(wpm=wpm)
        locator = self.page.locator(selector).first

        await typer.type(locator, text)

    async def human_scroll(self, *, scrolls: int = 2) -> None:
        """Perform randomized smooth scrolling down the page."""
        await self.stop_idle()
        try:
            async with self.lock:
                for _ in range(scrolls):
                    scroll_amount = random.randint(350, 650)
                    chunks = random.randint(12, 22)

                    for i in range(1, chunks + 1):
                        raw_t = i / chunks
                        t = math.sin(raw_t * math.pi / 2)

                        prev_raw_t = (i - 1) / chunks
                        prev_t = math.sin(prev_raw_t * math.pi / 2)

                        chunk_delta = (t - prev_t) * scroll_amount
                        await self.page.mouse.wheel(delta_x=0, delta_y=chunk_delta)
                        await asyncio.sleep(random.uniform(0.012, 0.028))

                    await random_delay(min_sec=0.8, max_sec=1.8)
        finally:
            await self.start_idle()


async def human_navigation(*, page: Page, url: str) -> None:
    """Navigate to a URL with humanized delays."""
    await random_delay(min_sec=0.5, max_sec=1.5)
    await page.goto(url, wait_until="domcontentloaded")
    await random_delay(min_sec=1.0, max_sec=2.5)
