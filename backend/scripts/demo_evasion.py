import asyncio
import logging

from app.services.browser.actions import EvasionMouse, human_navigation
from app.services.browser.manager import BrowserManager

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")


async def main():
    manager = BrowserManager(brand_id="default")

    logging.info("Starting headed browser to demo evasion techniques...")
    try:
        async with manager.get_context(platform_name="x", headless=False) as context:
            page = context.pages[0] if context.pages else await context.new_page()

            logging.info("1. Demonstrating human_navigation...")
            await human_navigation(
                page=page, url="https://en.wikipedia.org/wiki/Main_Page"
            )

            # Inject a red dot AFTER navigation so it doesn't get wiped out by the page load!
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

            mouse = EvasionMouse(page)

            logging.info(
                "2. Starting 'sitting duck' idle movements... Watch the red dot wiggle!"
            )
            await mouse.start_idle()

            # Wait for a bit so the user can see the idle wiggles
            await asyncio.sleep(8)

            logging.info("3. Demonstrating human_type (and human_click internally)...")
            # Type into the Wikipedia search bar (this will safely pause the idle wiggles automatically)
            await mouse.human_type(
                selector="input[name='search']", text="Playwright (software)", delay=150
            )

            logging.info("4. Demonstrating human_click (Bezier curve)...")
            # Click the search button
            await mouse.human_click(selector="button:has-text('Search')")

            logging.info("5. Demonstrating human_scroll...")
            await page.wait_for_load_state("domcontentloaded")
            await mouse.human_scroll(scrolls=2)

            logging.info(
                "Demo complete! Letting it sit idle for 5 seconds to show it resumes wiggling."
            )
            await asyncio.sleep(5)
            await mouse.stop_idle()

    except FileNotFoundError:
        logging.error(
            "No session found. Run `uv run python scripts/headed_login.py --platform x` first."
        )
    except Exception as e:
        logging.error(f"Error during demo: {e}")


if __name__ == "__main__":
    asyncio.run(main())
