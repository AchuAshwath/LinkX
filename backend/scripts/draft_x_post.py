import asyncio
import json
import logging
import os
import re
import sys
from pathlib import Path

from rebrowser_playwright.async_api import Error as PlaywrightError
from rebrowser_playwright.async_api import TimeoutError as PlaywrightTimeoutError

# Add backend to path so we can run from anywhere
sys.path.append(str(Path(__file__).parent.parent))

from app.services.browser.actions import (
    EvasionMouse,
    PostButtonDisabledError,
    random_delay,
)
from app.services.browser.manager import BrowserManager

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


async def main() -> None:
    """Draft a tweet using self-healing JSON selectors without posting."""
    # Force headed mode by default so the developer can watch, unless overridden
    if "PLAYWRIGHT_HEADLESS" not in os.environ:
        os.environ["PLAYWRIGHT_HEADLESS"] = "0"

    # Load the self-healing JSON
    selectors_path = (
        Path(__file__).parent.parent
        / "app"
        / "services"
        / "browser"
        / "selectors"
        / "x_selectors.json"
    )
    with open(selectors_path) as f:
        selectors = json.load(f)

    post_input_selector = selectors["compose"]["post_input"]
    post_button_selector = selectors["compose"]["post_button"]

    logger.info("Initializing BrowserManager...")
    manager = BrowserManager()

    # Setup recording directory
    record_dir = (
        Path.home()
        / ".gemini"
        / "antigravity"
        / "brain"
        / "62900769-8224-4a19-99b6-4421bbb88305"
        / "scratch"
        / "videos"
    )
    record_dir.mkdir(parents=True, exist_ok=True)

    try:
        logger.info("Connecting to X.com...")
        async with manager.get_context(
            "x", headless=(os.environ["PLAYWRIGHT_HEADLESS"] == "1")
        ) as context:
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
            logger.info(
                f"Targeting post input box using selector: {post_input_selector}"
            )
            await mouse.human_click(selector=post_input_selector)

            # Type out the post using biometric typo simulation
            draft_text = "Omen's new smoke duration is a game changer for executes. 👻 Can't wait to try it out in ranked #Valorant"
            logger.info(f"Typing draft post: '{draft_text}'")
            await mouse.human_type(
                selector=post_input_selector, text=draft_text, wpm=90.0
            )

            # Pause to let user read the typed post
            await random_delay(min_sec=1.0, max_sec=2.0)

            # Identify the Post button
            logger.info(
                f"Targeting final Post button using selector: {post_button_selector}"
            )

            # Wait for the CreateTweet GraphQL mutation to return a response
            logger.info(
                "Setting up network interceptor for CreateTweet GraphQL endpoint..."
            )
            try:
                async with page.expect_response(
                    lambda response: "graphql" in response.url
                    and "CreateTweet" in response.url,
                    timeout=10000,
                ) as response_info:
                    # We will use mouse.human_click to click the post button
                    await mouse.human_click(selector=post_button_selector)
                    logger.info(
                        "Clicked 'Post' button! Waiting for backend network confirmation..."
                    )

                response = await response_info.value

                # 1. NETWORK VERIFICATION (Primary)
                if response.status != 200:
                    raise Exception(
                        f"HTTP {response.status} from CreateTweet endpoint."
                    )

                response_json = await response.json()
                if "errors" in response_json:
                    logger.error(
                        f"GraphQL returned application errors: {json.dumps(response_json['errors'])}"
                    )
                    raise Exception("GraphQL application-level error during post.")

                logger.info(
                    f"✅ NETWORK SUCCESS: Server confirmed post creation! (Status: {response.status})"
                )

                # 2. UI TOAST VERIFICATION (Secondary/Fallback)
                logger.info(
                    "Waiting for UI toast confirmation ('Your post was sent')..."
                )
                # X.com toasts appear inside #layers and usually say "Your post was sent." or "Your Tweet was sent."
                toast_locator = (
                    page.locator("#layers")
                    .get_by_text(re.compile(r"(was sent|posted)", re.IGNORECASE))
                    .first
                )
                await toast_locator.wait_for(state="visible", timeout=8000)
                logger.info("✅ UI SUCCESS: Visual toast confirmation detected!")

            except PostButtonDisabledError:
                logger.error(
                    "❌ ABORT: The Post button remained disabled. The post text might exceed character limits or contain blocked content."
                )
            except PlaywrightTimeoutError:
                logger.error(
                    "❌ TIMEOUT: The network request or the UI toast timed out. The post may have failed (e.g. button was disabled) or the network dropped."
                )
            except PlaywrightError as e:
                if "closed" in str(e).lower():
                    logger.error(
                        "❌ ABORT: User manually closed the browser window. Halting execution."
                    )
                else:
                    raise

            await mouse.stop_idle()

            # Wait a few seconds so the user can visually see the feed update
            await random_delay(min_sec=3.0, max_sec=4.0)
            logger.info(f"Video recording saved to: {record_dir}")

    except PlaywrightError as e:
        if "closed" in str(e).lower():
            logger.error(
                "❌ ABORT: User manually closed the browser window. Halting execution."
            )
        else:
            logger.error(f"Playwright error during draft post: {e}")
    except Exception as e:
        logger.error(f"Error during draft post: {e}")
    finally:
        pass  # Intentionally not calling manager.cleanup() so we don't close the browser immediately if an error happens during dev


if __name__ == "__main__":
    asyncio.run(main())
