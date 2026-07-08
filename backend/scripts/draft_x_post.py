import asyncio
import json
import logging
import os
import sys
from pathlib import Path

# Add backend to path so we can run from anywhere
sys.path.append(str(Path(__file__).parent.parent))

from app.services.browser.manager import BrowserManager
from app.services.browser.actions import EvasionMouse, random_delay

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


async def main() -> None:
    """Draft a tweet using self-healing JSON selectors without posting."""
    # Force headed mode by default so the developer can watch, unless overridden
    if "PLAYWRIGHT_HEADLESS" not in os.environ:
        os.environ["PLAYWRIGHT_HEADLESS"] = "0"
    
    # Load the self-healing JSON
    selectors_path = Path(__file__).parent.parent / "app" / "services" / "browser" / "selectors" / "x_selectors.json"
    with open(selectors_path) as f:
        selectors = json.load(f)
        
    post_input_selector = selectors["compose"]["post_input"]
    post_button_selector = selectors["compose"]["post_button"]
    
    logger.info("Initializing BrowserManager...")
    manager = BrowserManager()
    
    try:
        async with manager.get_context("x", headless=False) as context:
            page = context.pages[0] if context.pages else await context.new_page()
            mouse = EvasionMouse(page)
            
            # Start background idling
            asyncio.create_task(mouse.start_idle())
            
            logger.info("Navigating to https://x.com/home")
            await page.goto("https://x.com/home", wait_until="domcontentloaded")
            
            # Inject a red dot so the user can visually track the headless mouse
            await page.evaluate("""
                const cursor = document.createElement('div');
                cursor.id = 'playwright-cursor';
                cursor.style.width = '24px';
                cursor.style.height = '24px';
                cursor.style.background = 'rgba(255, 0, 0, 0.7)';
                cursor.style.border = '2px solid white';
                cursor.style.position = 'fixed';
                cursor.style.borderRadius = '50%';
                cursor.style.pointerEvents = 'none';
                cursor.style.zIndex = '2147483647';
                document.documentElement.appendChild(cursor);

                window.addEventListener('mousemove', (e) => {
                    const c = document.getElementById('playwright-cursor');
                    if (c) {
                        c.style.left = e.clientX - 12 + 'px';
                        c.style.top = e.clientY - 12 + 'px';
                    }
                }, { capture: true });
            """)
            
            # Wait for feed to load (gives time for user to see idle wiggles)
            logger.info("Waiting for feed to load...")
            await random_delay(min_sec=4.0, max_sec=6.0)
            
            # Click the post input box using Bezier evasion
            logger.info(f"Targeting post input box using selector: {post_input_selector}")
            await mouse.human_click(selector=post_input_selector)
            
            # Type out the post using biometric typo simulation
            draft_text = "This is a test post orchestrated by a self-healing LangGraph automation framework."
            logger.info(f"Typing draft post: '{draft_text}'")
            await mouse.human_type(selector=post_input_selector, text=draft_text, wpm=90.0)
            
            # Pause to let user read the typed post
            await random_delay(min_sec=2.0, max_sec=3.0)
            
            # Identify the Post button, but DO NOT click it
            logger.info(f"Targeting final Post button using selector: {post_button_selector}")
            
            post_button = page.locator(post_button_selector).first
            await post_button.scroll_into_view_if_needed()
            
            # We will use mouse.human_click but we need a way to just hover, or we can use Playwright hover
            box = await post_button.bounding_box()
            if box:
                target_x = box["x"] + (box["width"] / 2)
                target_y = box["y"] + (box["height"] / 2)
                # Use lock so we don't race with the idle loop
                async with mouse.lock:
                    await mouse._move_mouse_internal(target_x, target_y, steps=25)
                logger.info("Mouse is now hovering perfectly over the 'Post' button.")
                logger.info("Draft complete! Waiting for your approval before clicking.")
            else:
                logger.warning("Could not find bounding box for the Post button.")
                
            await mouse.stop_idle()
            
            logger.info("Pausing for visual inspection. Close inspector to exit.")
            await page.pause()
            
    except Exception as e:
        logger.error(f"Error during draft post: {e}")
    finally:
        pass # Intentionally not calling manager.cleanup() so we don't close the browser immediately if an error happens during dev

if __name__ == "__main__":
    asyncio.run(main())
