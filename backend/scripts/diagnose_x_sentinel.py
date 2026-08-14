import asyncio
import os

from app.services.browser.manager import BrowserManager


async def main():
    manager = BrowserManager(brand_id="default")
    headless = os.environ.get("PLAYWRIGHT_HEADLESS", "1") == "1"

    async with manager.get_context("x", headless=headless) as context:
        page = context.pages[0] if context.pages else await context.new_page()

        print("Navigating to https://x.com/home")
        await page.goto("https://x.com/home", wait_until="domcontentloaded")

        # Wait 5s to load
        await page.wait_for_timeout(5000)

        print("Checking selectors...")

        selectors = [
            "nav[aria-label='Primary navigation']",
            "[data-testid='AppTabBar_Home_Link']",
            "a[href='/home']",
            "nav",
        ]

        for sel in selectors:
            try:
                count = await page.locator(sel).count()
                print(f"Selector '{sel}': found {count} elements")
                if count > 0 and sel == "nav":
                    # print aria-labels of navs
                    for i in range(count):
                        label = (
                            await page.locator(sel).nth(i).get_attribute("aria-label")
                        )
                        print(f"  nav[{i}] aria-label = {label}")
            except Exception as e:
                print(f"Error checking {sel}: {e}")


if __name__ == "__main__":
    asyncio.run(main())
