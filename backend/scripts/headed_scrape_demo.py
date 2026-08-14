import os
import sys

# Force PLAYWRIGHT_HEADLESS to 0 at the very top
os.environ["PLAYWRIGHT_HEADLESS"] = "0"

import asyncio

from scripts.scrape_trending_topics import scrape_trending_topics


async def main():
    brand_id = (
        sys.argv[1] if len(sys.argv) > 1 else "989cb0e8-93ab-4763-9dc9-bf48a232e683"
    )
    print(f"Starting headed scrape for brand_id {brand_id}...")

    # We patch sys.argv because scrape_trending_topics reads sys.argv[1] directly
    sys.argv = ["scrape_trending_topics.py", brand_id]

    try:
        result = await scrape_trending_topics()
        print("\n✅ Scrape completed!")
        print(f"Status: {result.status}")
        print(f"Topics Found: {result.topics_found}")
        print(f"Topics Scraped: {result.topics_scraped}")
    except Exception as e:
        print(f"\n❌ Error during scraping: {e}")


if __name__ == "__main__":
    asyncio.run(main())
