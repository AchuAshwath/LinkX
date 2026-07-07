"""Verify that a previously established browser session is still authenticated.

Loads the persistent Chromium profile written by ``headed_login.py`` and
navigates to the platform's home feed.  Prints the first few posts on success.

Usage::

    uv run python scripts/test_session.py --platform x --brand-id default
    uv run python scripts/test_session.py --platform linkedin
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import platform
import sys
from pathlib import Path

from rebrowser_playwright.async_api import async_playwright

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("test_session")

PLATFORM_CONFIG = {
    "x": {
        "url": "https://x.com/",
        "sentinel": (
            "[data-testid='AppTabBar_Home_Link'], "
            "[data-testid='SideNav_AccountSwipe_Button']"
        ),
        "posts_selector": "[data-testid='tweetText']",
        "name": "X (Twitter)",
    },
    "linkedin": {
        "url": "https://www.linkedin.com/feed/",
        "sentinel": "div[data-test-id='nav-current-user'], .global-nav__me",
        "posts_selector": ".feed-shared-update-v2__description",
        "name": "LinkedIn",
    },
}


def _playwright_args_for_os() -> list[str]:
    """Return OS-specific Chrome flags needed to decrypt the session cookies.

    The headed_login.py subprocess writes cookies using:
      macOS   → --use-mock-keychain + --password-store=basic
      Linux   → --password-store=basic
      Windows → --password-store=basic

    We must pass the exact same flags here so Playwright uses the same
    encryption key and can actually read the cookies.
    """
    args = [
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--password-store=basic",
    ]
    if platform.system() == "Darwin":
        args.append("--use-mock-keychain")
    return args


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify a saved browser session is still authenticated."
    )
    parser.add_argument(
        "--platform",
        choices=list(PLATFORM_CONFIG.keys()),
        default="x",
        help="The platform to verify (default: x)",
    )
    parser.add_argument(
        "--brand-id",
        default="default",
        help="Brand / persona identifier (default: 'default')",
    )
    args = parser.parse_args()

    config = PLATFORM_CONFIG[args.platform]
    script_dir = Path(__file__).resolve().parent
    session_dir = script_dir.parent / "sessions" / args.brand_id / args.platform

    if not session_dir.exists():
        logger.error("Session directory not found at: %s", session_dir)
        logger.error(
            "Please run:  uv run python scripts/headed_login.py "
            "--platform %s --brand-id %s",
            args.platform,
            args.brand_id,
        )
        sys.exit(1)

    logger.info("Loading persistent context from: %s", session_dir)
    logger.info("Platform : %s", config["name"])

    playwright_args = _playwright_args_for_os()

    async with async_playwright() as p:
        # Try installed Google Chrome first (better OS integration),
        # fall back to the Playwright-bundled Chromium binary.
        try:
            logger.info("Launching with channel='chrome'...")
            context = await p.chromium.launch_persistent_context(
                user_data_dir=str(session_dir),
                headless=False,
                channel="chrome",
                viewport={"width": 1280, "height": 800},
                ignore_default_args=["--enable-automation"],
                args=playwright_args,
            )
        except Exception as e:
            logger.warning(
                "Could not launch with channel='chrome', "
                "falling back to bundled Chromium. Error: %s",
                e,
            )
            context = await p.chromium.launch_persistent_context(
                user_data_dir=str(session_dir),
                headless=False,
                viewport={"width": 1280, "height": 800},
                ignore_default_args=["--enable-automation"],
                args=playwright_args,
            )

        cookies = await context.cookies()
        logger.info("Cookies loaded into context: %s", [c["name"] for c in cookies])

        page = await context.new_page()
        logger.info("Navigating to %s ...", config["url"])
        await page.goto(config["url"], wait_until="domcontentloaded")

        logger.info("Checking authentication state...")
        await asyncio.sleep(5)  # allow JS to settle

        element = await page.query_selector(config["sentinel"])
        if element and await element.is_visible():
            logger.info("SUCCESS: Logged in! Home feed detected.")

            posts = await page.query_selector_all(config["posts_selector"])
            if posts:
                logger.info("Found %d posts on your timeline:", len(posts))
                for i, post in enumerate(posts[:5], 1):
                    text = await post.inner_text()
                    logger.info("Post %d:\n%s\n%s", i, "-" * 40, text)
            else:
                logger.info("No posts found yet (timeline might still be loading).")
        else:
            logger.error("FAILED: Not logged in — feed element not found.")
            logger.info("Current URL: %s", page.url)
            logger.info(
                "Re-run headed_login.py to refresh the session:\n"
                "  uv run python scripts/headed_login.py "
                "--platform %s --brand-id %s",
                args.platform,
                args.brand_id,
            )

        logger.info(
            "Keeping the browser open for 10 seconds so you can verify manually..."
        )
        await asyncio.sleep(10)
        logger.info("Closing browser context...")
        await context.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Test script aborted by user.")
