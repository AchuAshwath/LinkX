import os
import sys

# Force PLAYWRIGHT_HEADLESS to 0 at the very top
os.environ["PLAYWRIGHT_HEADLESS"] = "0"

import asyncio

from scripts.scrape_trending_topics import scrape_trending_topics


async def main():
    user_id = sys.argv[1] if len(sys.argv) > 1 else None
    print(f"Starting headed scrape for user_id {user_id}...")

    try:
        result = await scrape_trending_topics(user_id=user_id, headless=False)
        print("\n✅ Scrape completed!")
        print(f"Status: {result.status}")
        print(f"Topics Found: {result.topics_found}")
        print(f"Topics Scraped: {result.topics_scraped}")
    except Exception as e:
        print(f"\n❌ Error during scraping: {e}")


if __name__ == "__main__":
    asyncio.run(main())
