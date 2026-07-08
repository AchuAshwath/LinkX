"""Verify that a previously established browser session is still authenticated.

Loads the persistent Chromium profile written by ``headed_login.py`` and
navigates to the platform's home feed.  Prints the first few posts on success.

This script is now a thin wrapper around the `backend.app.services.browser` library.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from app.services.browser import PLATFORMS, BrowserManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("test_session")


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify a saved browser session is still authenticated."
    )
    parser.add_argument(
        "--platform",
        choices=list(PLATFORMS.keys()),
        default="x",
        help="The platform to verify (default: x)",
    )
    parser.add_argument(
        "--brand-id",
        default="default",
        help="Brand / persona identifier (default: 'default')",
    )
    args = parser.parse_args()

    config = PLATFORMS[args.platform]
    manager = BrowserManager(brand_id=args.brand_id)

    logger.info("Platform : %s", config.name)

    try:
        async with manager.get_context(
            platform_name=args.platform, headless=False
        ) as context:
            cookies = await context.cookies()
            logger.info("Cookies loaded into context: %s", [c["name"] for c in cookies])

            page = context.pages[0] if context.pages else await context.new_page()
            for p in context.pages[1:]:
                await p.close()
            logger.info("Navigating to %s ...", config.url)
            await page.goto(config.url, wait_until="domcontentloaded")

            logger.info("Checking authentication state...")
            await asyncio.sleep(5)  # allow JS to settle

            element = await page.query_selector(config.sentinel_selector)
            if element and await element.is_visible():
                logger.info("SUCCESS: Logged in! Home feed detected.")

                posts = await page.query_selector_all(config.posts_selector)
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

    except Exception as e:
        logger.error(str(e))
        sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Test script aborted by user.")
