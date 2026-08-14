import os

# Force PLAYWRIGHT_HEADLESS to 0 at the very top of the process
os.environ["PLAYWRIGHT_HEADLESS"] = "0"

import asyncio
import sys

from sqlmodel import Session, select

from app.core.db import engine
from app.models import User
from app.services.x_posts import XPostClient


async def main():
    user_email = sys.argv[1] if len(sys.argv) > 1 else "admin@linkx.dev"
    content = sys.argv[2] if len(sys.argv) > 2 else "Test post from headed script! 🤖"

    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == user_email)).first()
        if not user:
            # Fallback to first user
            user = session.exec(select(User)).first()
        if not user:
            print("User not found!")
            return

    print(f"Opening headed X.com post automation for user: {user.email} ({user.id})")
    print(f"Content: {content}")

    client = XPostClient()
    try:
        rest_id = await client.create_text_post(user_id=str(user.id), content=content)
        print(f"\n✅ Successfully posted! rest_id = {rest_id}")
    except Exception as e:
        print(f"\n❌ Error during posting: {e}")


if __name__ == "__main__":
    asyncio.run(main())
