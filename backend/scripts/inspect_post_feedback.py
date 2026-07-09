import asyncio
import logging
import sys
from pathlib import Path

# Add backend to path so we can run from anywhere
sys.path.append(str(Path(__file__).parent.parent))

from app.services.browser.manager import BrowserManager

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


async def main() -> None:
    """Launch headed browser, wait for user to post, and dump DOM to find toast."""

    logger.info("Initializing BrowserManager...")
    manager = BrowserManager()

    try:
        logger.info("Connecting to X.com...")
        async with manager.get_context("x", headless=False) as context:
            # Get the first page or create one
            page = context.pages[0] if context.pages else await context.new_page()

            logger.info("Navigating to https://x.com/home")
            await page.goto("https://x.com/home", wait_until="domcontentloaded")

            logger.info("Playwright paused. Please:")
            logger.info("1. Write a random test post manually.")
            logger.info("2. Click the 'Post' button.")
            logger.info(
                "3. The MOMENT you see the 'Your post was sent' toast popup, click the 'Resume' button in the Playwright Inspector!"
            )
            await page.pause()

            # Extract the raw HTML content right after resume
            logger.info("Extracting DOM to find the success toast...")
            html_content = await page.content()

            # Save it to the artifacts scratch directory for the AI to read
            scratch_dir = (
                Path.home()
                / ".gemini"
                / "antigravity"
                / "brain"
                / "62900769-8224-4a19-99b6-4421bbb88305"
                / "scratch"
            )
            scratch_dir.mkdir(parents=True, exist_ok=True)

            output_file = scratch_dir / "x_toast_dom.html"
            with open(output_file, "w", encoding="utf-8") as f:
                f.write(html_content)

            logger.info(f"Successfully saved full HTML to {output_file}")

    except Exception as e:
        logger.error(f"Error during inspection: {e}")


if __name__ == "__main__":
    asyncio.run(main())
