"""Humanized interactions for Playwright browser automation."""

from __future__ import annotations

import asyncio
import random
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from rebrowser_playwright.async_api import BrowserContext, Page


async def inject_stealth(context: BrowserContext) -> None:
    """Inject basic Javascript stealth patches into every page of the context.

    Masks the most obvious automation signals like navigator.webdriver.
    """
    script = """
        // Pass the Webdriver Test
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });

        // Pass the Plugins Length Test
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });

        // Spoof Hardware Concurrency (hide server CPUs)
        Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: () => 8,
        });

        // Pass the Chrome Test
        window.chrome = {
            runtime: {}
        };
    """
    await context.add_init_script(script)


async def random_delay(min_sec: float = 0.5, max_sec: float = 2.0) -> None:
    """Pause execution for a random duration between min_sec and max_sec."""
    delay = random.uniform(min_sec, max_sec)
    await asyncio.sleep(delay)


async def human_type(page: Page, selector: str, text: str, delay: int = 100) -> None:
    """Type text into a field with randomized keystroke delays.

    Args:
        page: The Playwright page.
        selector: CSS selector for the input field.
        text: The text to type.
        delay: Base delay between keystrokes in milliseconds.
    """
    await page.wait_for_selector(selector)
    await page.click(selector)
    await random_delay(0.2, 0.5)

    for char in text:
        # Add some jitter to the typing speed (+/- 50% of base delay)
        jitter = random.uniform(-0.5, 0.5) * delay
        actual_delay_ms = max(10, delay + jitter)
        await page.keyboard.type(char, delay=int(actual_delay_ms))

        # Occasionally pause longer (simulate reading or thinking)
        if random.random() < 0.05:
            await random_delay(0.5, 1.5)


async def human_scroll(page: Page, scrolls: int = 3) -> None:
    """Perform randomized scrolling down the page.

    Useful for triggering lazy-loaded feeds or making the session look human.
    """
    for _ in range(scrolls):
        # Scroll down by a random fraction of the viewport height
        scroll_amount = random.randint(300, 800)
        await page.mouse.wheel(delta_x=0, delta_y=scroll_amount)
        await random_delay(1.0, 3.0)


async def human_navigation(page: Page, url: str) -> None:
    """Navigate to a URL with humanized delays.

    Prevents instant robotic navigation loops.
    """
    await random_delay(0.5, 1.5)
    await page.goto(url, wait_until="domcontentloaded")
    await random_delay(1.0, 2.5)


async def human_click(page: Page, selector: str) -> None:
    """Click an element using simulated, non-linear mouse movements.

    Vanilla page.click() instantly teleports the mouse to the center
    of the element, which is a major red flag for advanced bot detectors.
    This function calculates a random point within the element's bounding box
    and moves the mouse there smoothly before clicking.
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

    # Move the mouse in steps to simulate a human path (simplified bezier)
    current_pos = await page.evaluate(
        "() => ({x: window.mouseX || 0, y: window.mouseY || 0})"
    )

    steps = random.randint(5, 15)
    for i in range(1, steps + 1):
        progress = i / steps
        # Add slight wobble
        wobble_x = random.uniform(-2, 2)
        wobble_y = random.uniform(-2, 2)

        step_x = current_pos["x"] + (x - current_pos["x"]) * progress + wobble_x
        step_y = current_pos["y"] + (y - current_pos["y"]) * progress + wobble_y

        await page.mouse.move(step_x, step_y)
        await asyncio.sleep(random.uniform(0.01, 0.03))

    # Final deliberate move to exact target
    await page.mouse.move(x, y)
    await random_delay(0.1, 0.3)
    await page.mouse.down()
    await random_delay(0.05, 0.15)
    await page.mouse.up()
