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
        
        # Wait a few seconds for the app to initialize
        await page.wait_for_timeout(5000)
        
        # Take a screenshot
        await page.screenshot(path="x_diagnostics.png")
        print("Screenshot saved to backend/x_diagnostics.png")
        
        # Check some common selectors
        selectors = [
            "nav[aria-label='Primary navigation']",
            "[data-testid='AppTabBar_Home_Link']",
            "[data-testid='tweetTextarea_0']",
            "a[href='/home']"
        ]
        
        for sel in selectors:
            elements = await page.locator(sel).count()
            print(f"Selector '{sel}': found {elements} elements")
            
        # Get the body text to see if we're on a login/error page
        text = await page.inner_text("body")
        print("\n--- BODY TEXT START ---")
        print(text[:500] + ("..." if len(text) > 500 else ""))
        print("--- BODY TEXT END ---")

if __name__ == "__main__":
    asyncio.run(main())
