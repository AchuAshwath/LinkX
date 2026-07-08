import asyncio
import logging
import os
import sys
from pathlib import Path

# Add backend to path so we can run from anywhere
sys.path.append(str(Path(__file__).parent.parent))

from app.services.browser.manager import BrowserManager
from app.services.browser.actions import random_delay

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


async def main() -> None:
    """Launch headed browser, go to X, and dump DOM."""
    
    logger.info("Initializing BrowserManager...")
    manager = BrowserManager()
    
    try:
        logger.info("Connecting to X.com...")
        async with manager.get_context("x", headless=False) as context:
            # Get the first page or create one
            page = context.pages[0] if context.pages else await context.new_page()
            
            logger.info("Navigating to https://x.com/home")
            await page.goto("https://x.com/home", wait_until="domcontentloaded")
            
            logger.info("Waiting 5 seconds for feed to populate...")
            await random_delay(min_sec=5.0, max_sec=6.0)
            
            # Extract the raw HTML content
            logger.info("Extracting DOM...")
            html_content = await page.content()
            
            # Save it to the artifacts scratch directory for the AI to read
            scratch_dir = Path.home() / ".gemini" / "antigravity" / "brain" / "62900769-8224-4a19-99b6-4421bbb88305" / "scratch"
            scratch_dir.mkdir(parents=True, exist_ok=True)
            
            output_file = scratch_dir / "x_dom.html"
            with open(output_file, "w", encoding="utf-8") as f:
                f.write(html_content)
                
            logger.info(f"Successfully saved full HTML to {output_file}")
            
            # Create a simple JSON configuration stub since we are here
            json_file = Path(__file__).parent.parent / "app" / "services" / "browser" / "selectors" / "x_selectors.json"
            json_file.parent.mkdir(parents=True, exist_ok=True)
            if not json_file.exists():
                with open(json_file, "w") as f:
                    f.write("{}")
                logger.info(f"Created empty JSON at {json_file}")
                
            logger.info("Pausing Playwright. You can now inspect the browser visually!")
            logger.info("Close the Playwright Inspector window to resume/quit the script.")
            await page.pause()
            
    except Exception as e:
        logger.error(f"Error during inspection: {e}")
    finally:
        await manager.cleanup()

if __name__ == "__main__":
    asyncio.run(main())
