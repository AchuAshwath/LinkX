import asyncio
import os

from app.services.browser.manager import BrowserManager


async def main():
    manager = BrowserManager(brand_id="989cb0e8-93ab-4763-9dc9-bf48a232e683")
    headless = os.environ.get("PLAYWRIGHT_HEADLESS", "1") == "1"

    async with manager.get_context("x", headless=headless) as context:
        page = context.pages[0] if context.pages else await context.new_page()
        print("Navigating to https://x.com/home")
        await page.goto("https://x.com/home", wait_until="domcontentloaded")

        await page.wait_for_timeout(5000)

        print(f"Final URL: {page.url}")

        count = await page.locator("[data-testid='AppTabBar_Home_Link']").count()
        print(f"Found home links: {count}")

        body = await page.inner_text("body")
        print(f"Body snippet: {body[:200]}")


if __name__ == "__main__":
    asyncio.run(main())
