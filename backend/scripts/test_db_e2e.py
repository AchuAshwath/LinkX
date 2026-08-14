import os

os.environ["PLAYWRIGHT_HEADLESS"] = "0"

import asyncio
import sys

from sqlmodel import Session, select

from app.core.db import engine
from app.models import Post, User
from app.services.publishing import publish_post


async def main():
    user_email = sys.argv[1] if len(sys.argv) > 1 else "admin@linkx.dev"
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == user_email)).first()
        if not user:
            user = session.exec(select(User)).first()
        if not user:
            print("User not found!")
            return

        print(f"Using user: {user.email} ({user.id})")

        # Create a post record
        content = (
            sys.argv[2]
            if len(sys.argv) > 2
            else "The new Apex Legends season is actually looking incredibly solid. The weapon sandbox changes are exactly what the game needed to feel fresh again. Time to grind some ranked! 🎮🔥 #ApexLegends #Gaming"
        )

        post = Post(
            content=content,
            platform="x",
            status="draft",
            owner_id=user.id,
            method="browser",
        )
        session.add(post)
        session.commit()
        session.refresh(post)

        print(f"Created Post in DB: ID={post.id}, status={post.status}")

        try:
            # Run the publishing state machine
            await publish_post(session=session, post=post, user_id=user.id)

            # Refresh to show updated status
            session.refresh(post)
            print("========================================")
            print(f"Final Post Status: {post.status}")
            print(f"External Post ID: {post.external_post_id}")
            print(f"Error Message: {post.error_message}")
            print("========================================")
        except Exception as e:
            print(f"Publishing failed: {e}")
            session.refresh(post)
            print(f"Post status is now: {post.status}")
            print(f"Error: {post.error_message}")


if __name__ == "__main__":
    asyncio.run(main())
