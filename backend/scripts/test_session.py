import asyncio
import logging
import sys
from pathlib import Path

from rebrowser_playwright.async_api import async_playwright

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("test_session")

SENTINEL_SELECTOR = (
    "[data-testid='AppTabBar_Home_Link'], [data-testid='SideNav_AccountSwipe_Button']"
)


async def main() -> None:
    # Locate the default X session
    script_dir = Path(__file__).resolve().parent
    session_dir = script_dir.parent / "sessions" / "default" / "x"

    if not session_dir.exists():
        logger.error("Session directory not found at: %s", session_dir)
        logger.error("Please run headed_login.py first to establish the session.")
        sys.exit(1)

    logger.info("Loading persistent context from: %s", session_dir)

    async with async_playwright() as p:
        # Launch Chrome using your installed browser (for maximum compatibility)
        # falling back to default Chromium if Chrome isn't found
        try:
            logger.info("Launching with channel='chrome'...")
            context = await p.chromium.launch_persistent_context(
                user_data_dir=str(session_dir),
                headless=False,
                channel="chrome",
                viewport={"width": 1280, "height": 800},
                ignore_default_args=["--enable-automation"],
                args=[
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                    "--no-sandbox",
                    "--disable-blink-features=AutomationControlled",
                    "--disable-infobars",
                    "--use-mock-keychain",
                    "--password-store=basic",
                ],
            )
            cookies = await context.cookies()
            logger.info("Cookies loaded into context: %s", [c["name"] for c in cookies])
        except Exception as e:
            logger.warning(
                "Could not launch with channel='chrome', trying default Chromium... Error: %s",
                e,
            )
            context = await p.chromium.launch_persistent_context(
                user_data_dir=str(session_dir),
                headless=False,
                viewport={"width": 1280, "height": 800},
                ignore_default_args=["--enable-automation"],
                args=[
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                    "--no-sandbox",
                    "--disable-blink-features=AutomationControlled",
                    "--disable-infobars",
                    "--use-mock-keychain",
                    "--password-store=basic",
                ],
            )

        page = await context.new_page()

        logger.info("Navigating to https://x.com/ ...")
        await page.goto("https://x.com/", wait_until="domcontentloaded")

        logger.info("Checking authentication state...")
        # Give it a few seconds to load pages/cookies
        await asyncio.sleep(5)

        # Check if the home feed element exists
        element = await page.query_selector(SENTINEL_SELECTOR)
        if element and await element.is_visible():
            logger.info("SUCCESS: You are logged in! Home feed detected.")

            # Find and print some post content from the home timeline if available
            posts = await page.query_selector_all("[data-testid='tweetText']")
            if posts:
                logger.info("Found %d tweets on your timeline:", len(posts))
                for i, post in enumerate(posts[:5], 1):
                    text = await post.inner_text()
                    logger.info("Tweet %d:\n%s\n%s", i, "-" * 40, text)
            else:
                logger.info(
                    "No tweets found on the page yet (timeline might still be loading)."
                )
        else:
            logger.error(
                "FAILED: Not logged in. Navigating to login/home feed failed or was redirected."
            )
            # Check the current URL to diagnose
            logger.info("Current URL: %s", page.url)

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
