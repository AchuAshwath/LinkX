import asyncio
import logging
import sys

from app.services.x_posts import XPostClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

async def main():
    post_content = "Just hit Immortal in Valorant! 🎮 The grind was real but the aim training finally paid off. Reyna diff all day! Who wants to queue? #Valorant #RiotGames #Gaming"
    
    print("========================================")
    print(f"Attempting to post: '{post_content}'")
    print("Using persona_id: 'default'")
    print("========================================\n")
    
    try:
        client = XPostClient()
        post_id = await client.create_text_post(
            persona_id="default",
            content=post_content
        )
        print(f"\n✅ Success! Tweet ID: {post_id}")
    except Exception as e:
        print(f"\n❌ Failed to post: {e}")

if __name__ == "__main__":
    asyncio.run(main())
