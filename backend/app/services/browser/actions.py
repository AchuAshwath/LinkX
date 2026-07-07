"""Humanized interactions for Playwright browser automation."""

from __future__ import annotations

import asyncio
import random
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from rebrowser_playwright.async_api import Page


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
