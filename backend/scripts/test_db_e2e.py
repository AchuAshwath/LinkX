import asyncio
import uuid
from sqlmodel import Session, select
from app.core.db import engine
from app.models import Post, PostCreate, Persona
from app.services.publishing import publish_post

async def main():
    with Session(engine) as session:
        persona = session.exec(select(Persona).where(Persona.name == "Ashwath N")).first()
        if not persona:
            print("Persona not found!")
            return
            
        print(f"Using persona: {persona.name} ({persona.id})")
        
        # Create a post record
        content = "The new Apex Legends season is actually looking incredibly solid. The weapon sandbox changes are exactly what the game needed to feel fresh again. Time to grind some ranked! 🎮🔥 #ApexLegends #Gaming"
        
        post = Post(
            content=content,
            platform="x",
            status="draft",
            persona_id=persona.id,
            owner_id=persona.user_id
        )
        session.add(post)
        session.commit()
        session.refresh(post)
        
        print(f"Created Post in DB: ID={post.id}, status={post.status}")
        
        try:
            # Run the publishing state machine
            await publish_post(session=session, post=post, user_id=persona.user_id)
            
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
