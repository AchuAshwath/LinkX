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
    persona_id = sys.argv[1] if len(sys.argv) > 1 else "default"
    post_content = sys.argv[2] if len(sys.argv) > 2 else "Just hit Immortal in Valorant! 🎮 The grind was real but the aim training finally paid off. Reyna diff all day! Who wants to queue? #Valorant #RiotGames #Gaming"
    
    print("========================================")
    print(f"Attempting to post: '{post_content}'")
    print(f"Using persona_id: '{persona_id}'")
    print("========================================\n")
    
    try:
        client = XPostClient()
        post_id = await client.create_text_post(
            persona_id=persona_id,
            content=post_content
        )
        print(f"\n✅ Success! Tweet ID: {post_id}")
    except Exception as e:
        print(f"\n❌ Failed to post: {e}")

if __name__ == "__main__":
    asyncio.run(main())
