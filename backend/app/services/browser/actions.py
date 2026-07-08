"""Humanized interactions for Playwright browser automation."""

from __future__ import annotations

import asyncio
import math
import random
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from rebrowser_playwright.async_api import Page


# Track mouse positions per page in Python to avoid DOM pollution.
# WAFs detect custom variables like window.mouseX.
_mouse_positions: dict[int, tuple[float, float]] = {}


async def random_delay(*, min_sec: float = 0.5, max_sec: float = 2.0) -> None:
    """Pause execution for a random duration between min_sec and max_sec."""
    delay = random.uniform(min_sec, max_sec)
    await asyncio.sleep(delay)


async def human_type(*, page: Page, selector: str, text: str, delay: int = 100) -> None:
    """Type text into a field with randomized keystroke delays.

    Args:
        page: The Playwright page.
        selector: CSS selector for the input field.
        text: The text to type.
        delay: Base delay between keystrokes in milliseconds.
    """
    await page.wait_for_selector(selector)
    # Use human_click instead of vanilla page.click to avoid teleportation
    await human_click(page=page, selector=selector)
    await random_delay(min_sec=0.2, max_sec=0.5)

    for char in text:
        # Add some jitter to the typing speed (+/- 50% of base delay)
        jitter = random.uniform(-0.5, 0.5) * delay
        actual_delay_ms = max(10, delay + jitter)
        await page.keyboard.type(char, delay=int(actual_delay_ms))

        # Occasionally pause longer (simulate reading or thinking)
        if random.random() < 0.05:
            await random_delay(min_sec=0.5, max_sec=1.5)


async def human_scroll(*, page: Page, scrolls: int = 3) -> None:
    """Perform randomized scrolling down the page.

    Useful for triggering lazy-loaded feeds or making the session look human.
    """
    for _ in range(scrolls):
        # Scroll down by a random fraction of the viewport height
        scroll_amount = random.randint(300, 800)
        await page.mouse.wheel(delta_x=0, delta_y=scroll_amount)
        await random_delay(min_sec=1.0, max_sec=3.0)


async def human_navigation(*, page: Page, url: str) -> None:
    """Navigate to a URL with humanized delays.

    Prevents instant robotic navigation loops.
    """
    await random_delay(min_sec=0.5, max_sec=1.5)
    await page.goto(url, wait_until="domcontentloaded")
    await random_delay(min_sec=1.0, max_sec=2.5)


def _cubic_bezier(t: float, p0: float, p1: float, p2: float, p3: float) -> float:
    """Calculate a point on a cubic Bezier curve."""
    return (
        (1 - t) ** 3 * p0
        + 3 * (1 - t) ** 2 * t * p1
        + 3 * (1 - t) * t**2 * p2
        + t**3 * p3
    )


async def human_click(*, page: Page, selector: str) -> None:
    """Click an element using simulated, non-linear mouse movements.

    Computes a cubic Bezier curve for the mouse path to evade behavioral detection.
    """
    await page.wait_for_selector(selector)

    # Get element bounding box
    locator = page.locator(selector).first
    box = await locator.bounding_box()
    if not box:
        # Fallback to standard click if box can't be computed
        await locator.click()
        return

    # Pick a random point inside the bounding box (not perfectly centered)
    x = box["x"] + (box["width"] * random.uniform(0.2, 0.8))
    y = box["y"] + (box["height"] * random.uniform(0.2, 0.8))

    page_id = id(page)
    start_x, start_y = _mouse_positions.get(page_id, (0.0, 0.0))

    dist = math.hypot(x - start_x, y - start_y)

    # Generate control points for a natural curve
    cp1_x = start_x + random.uniform(-dist * 0.2, dist * 0.2)
    cp1_y = start_y + random.uniform(-dist * 0.2, dist * 0.2)
    cp2_x = x + random.uniform(-dist * 0.2, dist * 0.2)
    cp2_y = y + random.uniform(-dist * 0.2, dist * 0.2)

    # Scale steps with distance (at least 10, max 40)
    steps = max(10, min(40, int(dist / 20)))

    for i in range(1, steps + 1):
        raw_t = i / steps
        # Ease-in-out to simulate Fitts's Law (slow start/end, fast middle)
        t = -(math.cos(math.pi * raw_t) - 1) / 2

        step_x = _cubic_bezier(t, start_x, cp1_x, cp2_x, x)
        step_y = _cubic_bezier(t, start_y, cp1_y, cp2_y, y)

        # Tiny high-frequency jitter
        step_x += random.uniform(-1.0, 1.0)
        step_y += random.uniform(-1.0, 1.0)

        await page.mouse.move(step_x, step_y)
        # Sleep duration varies slightly to simulate processing limits
        await asyncio.sleep(random.uniform(0.01, 0.02))

    # Final deliberate move to exact target
    await page.mouse.move(x, y)
    _mouse_positions[page_id] = (x, y)

    await random_delay(min_sec=0.1, max_sec=0.3)
    await page.mouse.down()
    await random_delay(min_sec=0.05, max_sec=0.15)
    await page.mouse.up()
