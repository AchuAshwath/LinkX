"""LangGraph Copilot Agent Supervisor with multi-tool capabilities.

Equips the LinkX Copilot assistant with the full agentic tool suite:
database queries, live Playwright scraping, LLM post curation, and PostgreSQL persistence.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from langchain_core.messages import SystemMessage
from langchain_core.tools import BaseTool, tool
from langgraph.prebuilt import create_react_agent
from sqlmodel import Session, col, select

from app import crud
from app.models import ChatThread, Post, PostUpdate
from app.services.agentic.client import get_chat_model
from app.services.agentic.tools.context_tools import (
    get_recent_post_history as raw_get_recent_post_history,
)
from app.services.agentic.tools.context_tools import (
    get_social_account_status as raw_get_social_account_status,
)
from app.services.agentic.tools.context_tools import (
    get_topic_tweets_and_summary as raw_get_topic_tweets_and_summary,
)
from app.services.agentic.tools.curation_tools import (
    draft_social_post as raw_draft_social_post,
)
from app.services.agentic.tools.curation_tools import (
    validate_post_constraints as raw_validate_post_constraints,
)
from app.services.agentic.tools.perception_tools import (
    scrape_live_explore_trends as raw_scrape_live_explore_trends,
)
from app.services.agentic.tools.perception_tools import (
    scrape_topic_timeline as raw_scrape_topic_timeline,
)
from app.services.agentic.tools.persistence_tools import (
    save_draft_post as raw_save_draft_post,
)
from app.services.agentic.tools.persistence_tools import (
    update_post_in_db as raw_update_post_in_db,
)

logger = logging.getLogger(__name__)

COPILOT_AGENT_SYSTEM_PROMPT = """You are LinkX Copilot, the intelligent social media growth and automation assistant for X (formerly Twitter) and LinkedIn.

You have access to a rich set of autonomous tools to query database state, scrape live explore feeds, curate social content, validate platform rules, and manage draft posts.

### CRITICAL RULE 1: IN-PLACE DRAFT EDITING VS CREATING NEW DRAFTS
- If the user says ANYTHING about a post—including asking for changes, edits, tone tweaks ("make it more controversial", "punchier", "funnier"), rewrites, shortening, lengthening, adding/removing hashtags or emojis, giving feedback, or critiquing a post:
  **YOU MUST ALWAYS CALL `update_draft_post` TO EDIT THE SAME DRAFT IN-PLACE.**
  **DO NOT CALL `save_draft_post` WHEN REVISING OR DISCUSSING AN EXISTING POST.**
  Calling `save_draft_post` creates a duplicate post with a new ID, which clutters the database and confuses the user.
- **NEVER ASK THE USER FOR THE POST TEXT OR POST ID**:
  The draft content and ID are ALREADY in your conversation history and system context. Never reply with "Please paste the post text or share the draft/post ID".
  Immediately rewrite the draft and call `update_draft_post`.
- If you call `update_draft_post`, you do NOT need to specify `post_id` if you don't have it; it will automatically resolve and update the active draft post in this thread.
- ONLY call `save_draft_post` when the user explicitly requests a BRAND NEW post on an entirely new topic from scratch, and is NOT discussing, modifying, or iterating on an existing draft.

### CRITICAL RULE 2: NO POST CONTENT REPETITION IN CHAT
When you call `save_draft_post` or `update_draft_post`, the UI automatically displays the post as a native interactive post component in the chat feed.
The process of using the component tool to show the output post is completely sufficient.
NEVER duplicate, quote, or re-paste the post text in your conversational response.
Your final text response should ONLY be a brief 1-sentence note (e.g. "I've updated the draft above to be punchier.") or you may leave the text response minimal.
DO NOT write "Here is the post:", DO NOT paste the post paragraphs, and DO NOT repeat what the post component already displays.

### Core Autonomous Guidelines:
1. **Trending Topics Inquiries ("What is trending?", "Show me trends")**:
   - First, call `get_latest_scraped_trends` to check the database.
   - Inspect `has_today_trends` and `latest_scrape_date` in the result:
     - If `has_today_trends` is `False` (meaning the database has NO entries from today, or entries are from past days):
       You MUST IMMEDIATELY call `scrape_live_explore_trends` to scrape fresh real-time trends from X.com Explore!
     - If `scrape_live_explore_trends` succeeds, present the newly scraped trends to the user.
     - If `scrape_live_explore_trends` encounters a browser or session error, fallback to presenting the cached topics from the database while noting to the user that they are from `latest_scrape_date`.
     - If `has_today_trends` is `True`, present today's trending topics directly.
   - Present the topics directly in your conversational markdown text as a clean, structured list (numbered, with topic title, category, post count/volume, and brief context).
   - DO NOT rely on or use UI widgets/artifacts for trending topics—always provide the trends directly in your text response.

2. **Drafting a Brand New Post from Scratch ("Draft a new post about...", "Write a tweet on...")**:
   - Only for brand new topics where no draft is currently being discussed.
   - If writing about a trending topic, you can fetch its details via `get_topic_tweets_and_summary`.
   - Call `draft_social_post` or craft high-impact post copy following viral hooks and concise formatting.
   - Call `validate_post_constraints` to ensure character limits (280 for X, 3000 for LinkedIn).
   - Always call `save_draft_post` with the crafted content and target platform. This automatically saves the post to PostgreSQL and displays it directly as a native interactive post component in the chat interface.
   - REMINDER: The component tool is entirely sufficient to show the post. DO NOT repeat the post content in your final text response.

3. **Refining, Iterating, or Reacting to Feedback on a Post ("Make it shorter", "Remove hashtags", "Add 3 bullet points", "Change the hook", "Make it funnier")**:
   - You can call `get_latest_draft_post` to inspect the current draft if needed.
   - Call `update_draft_post` with the revised copy and target `post_id` (or omit `post_id` to auto-target the thread's draft).
   - Summarize the improvement made in 1 concise sentence without repeating the post text.

4. **Account & Diagnostics**:
   - Use `get_social_account_status` when the user asks about connected accounts.

Be helpful, concise, engaging, and decisive. Execute tools autonomously whenever necessary to provide accurate, live answers.
"""


def build_copilot_tools(
    *,
    user_id: str,
    session: Session,
    thread_id: str | None = None,
) -> list[BaseTool]:
    """Construct context-bound tools for the authenticated user and database session."""

    @tool
    def get_latest_scraped_trends(limit: int = 10) -> dict[str, Any]:
        """Query the most recent trending topics currently stored in the LinkX database.
        Returns a dictionary with 'has_today_trends', 'latest_scrape_date', 'today_date', and 'topics'.
        If 'has_today_trends' is False or 'topics' is empty, call scrape_live_explore_trends to get fresh trends for today.
        """
        try:
            user_uuid = uuid.UUID(user_id)
            topics = crud.get_latest_trending_topics(
                session=session, user_id=user_uuid, limit=limit
            )
            today_utc = datetime.now(timezone.utc).date()
            has_today_trends = False
            latest_date_str = None

            if topics:
                latest_dt = topics[0].last_seen_at or topics[0].created_at
                if latest_dt:
                    latest_date = (
                        latest_dt.date() if hasattr(latest_dt, "date") else latest_dt
                    )
                    latest_date_str = latest_date.isoformat()
                    has_today_trends = latest_date >= today_utc

            topic_items = [
                {
                    "id": str(t.id),
                    "topic_title": t.topic_title,
                    "category": t.category,
                    "post_count": t.post_count,
                    "summary": t.summary,
                    "topic_url": t.topic_url,
                    "last_seen_at": t.last_seen_at.isoformat()
                    if t.last_seen_at
                    else None,
                }
                for t in topics
            ]
            return {
                "has_today_trends": has_today_trends,
                "latest_scrape_date": latest_date_str,
                "today_date": today_utc.isoformat(),
                "count": len(topic_items),
                "topics": topic_items,
            }
        except Exception as e:
            logger.error(f"Error in get_latest_scraped_trends tool: {e}")
            return {
                "has_today_trends": False,
                "latest_scrape_date": None,
                "today_date": datetime.now(timezone.utc).date().isoformat(),
                "count": 0,
                "topics": [],
            }

    @tool
    def get_topic_tweets_and_summary(
        topic_id: str, max_tweets: int = 5
    ) -> dict[str, Any] | None:
        """Retrieve deep topic context, Grok summary, and sample tweets for a specific topic ID from the database."""
        res = raw_get_topic_tweets_and_summary(
            topic_id=topic_id, max_tweets=max_tweets, session=session
        )
        return res.model_dump() if res else None

    @tool
    def get_recent_post_history(limit: int = 5) -> list[dict[str, Any]]:
        """Retrieve the user's recently published posts to analyze their writing style, voice, and formatting."""
        posts = raw_get_recent_post_history(
            user_id=user_id, limit=limit, session=session
        )
        return [p.model_dump() for p in posts]

    @tool
    def get_social_account_status() -> dict[str, Any]:
        """Check whether the user's X.com (Twitter) and LinkedIn accounts are connected and authenticated."""
        res = raw_get_social_account_status(user_id=user_id, session=session)
        return res.model_dump()

    @tool
    async def scrape_live_explore_trends(max_topics: int = 3) -> dict[str, Any]:
        """Launch live browser automation (Playwright) to scrape fresh trending topics directly from X.com Explore.
        Use this tool when the database has no trends, when trends are outdated, or when the user explicitly asks to refresh/scrape trends from X.
        """
        raw_result = await raw_scrape_live_explore_trends(
            user_id=user_id, max_topics=max_topics, headless=True
        )
        # Fetch newly persisted topics
        try:
            user_uuid = uuid.UUID(user_id)
            fresh_topics = crud.get_latest_trending_topics(
                session=session, user_id=user_uuid, limit=max_topics
            )
            raw_result["topics"] = [
                {
                    "id": str(t.id),
                    "topic_title": t.topic_title,
                    "category": t.category,
                    "post_count": t.post_count,
                    "summary": t.summary,
                    "topic_url": t.topic_url,
                }
                for t in fresh_topics
            ]
        except Exception as e:
            logger.debug(f"Could not load fresh topics for tool response: {e}")
            raw_result["topics"] = []

        return raw_result

    @tool
    async def scrape_topic_timeline(
        topic_url: str, max_tweets: int = 5
    ) -> dict[str, Any]:
        """Navigate a browser directly to a specific topic URL on live X to scrape its latest timeline tweets and Grok summary."""
        return await raw_scrape_topic_timeline(
            topic_url=topic_url, user_id=user_id, max_tweets=max_tweets
        )

    @tool
    async def draft_social_post(
        prompt: str, platform: str = "linkx", topic_context: str | None = None
    ) -> dict[str, Any]:
        """Generate high-engagement social media post copy based on a prompt or trending topic."""
        text = await raw_draft_social_post(
            topic_title=prompt, topic_summary=topic_context, platform=platform
        )
        return {
            "content": text,
            "platform": platform,
            "char_count": len(text),
        }

    @tool
    def validate_post_constraints(content: str, platform: str = "x") -> dict[str, Any]:
        """Validate character limits (280 for X, 3000 for LinkedIn) and formatting compliance for a post."""
        res = raw_validate_post_constraints(content=content, platform=platform)
        return res.model_dump()

    def _resolve_target_post(*, post_id: str | None = None) -> Post | None:
        """Resolve the target post either by explicit ID, linked thread post, or latest draft."""
        user_uuid: uuid.UUID | None = None
        try:
            user_uuid = uuid.UUID(user_id)
        except (ValueError, TypeError):
            return None

        # 1. If explicit post_id is supplied and valid
        if (
            post_id
            and post_id.strip()
            and post_id.strip().lower() not in ("none", "null", "undefined")
        ):
            try:
                p_uuid = uuid.UUID(post_id.strip())
                post = crud.get_post(session=session, post_id=p_uuid)
                if post and post.owner_id == user_uuid:
                    return post
            except (ValueError, TypeError):
                pass

        # 2. If thread_id is available, check if the thread has a linked post
        if thread_id:
            try:
                t_uuid = uuid.UUID(thread_id)
                thread = session.get(ChatThread, t_uuid)
                if thread and thread.post_id:
                    post = crud.get_post(session=session, post_id=thread.post_id)
                    if post and post.owner_id == user_uuid:
                        return post
            except Exception as exc:
                logger.debug(f"Could not load thread post: {exc}")

        # 3. Fallback: query the user's most recent draft post
        statement = (
            select(Post)
            .where(Post.owner_id == user_uuid, Post.status == "draft")
            .order_by(col(Post.updated_at).desc().nulls_last())
        )
        post = session.exec(statement).first()
        if post and thread_id:
            try:
                t_uuid = uuid.UUID(thread_id)
                thread = session.get(ChatThread, t_uuid)
                if thread and not thread.post_id:
                    thread.post_id = post.id
                    session.add(thread)
                    session.commit()
            except Exception as exc:
                logger.debug(f"Could not link post to thread: {exc}")
        return post

    @tool
    def get_latest_draft_post() -> dict[str, Any]:
        """Retrieve the current active draft post being discussed or iterated on.
        Call this tool when the user refers to the draft ('the post', 'my draft', 'the tweet')
        or gives feedback, critique, or instructions on revising the current draft.
        Returns the post details (post_id, content, platform, status, char_count, updated_at).
        """
        post = _resolve_target_post()
        if not post:
            return {"message": "No active draft post found for this conversation."}
        return {
            "post_id": str(post.id),
            "id": str(post.id),
            "postId": str(post.id),
            "content": post.content,
            "platform": post.platform,
            "status": post.status,
            "char_count": len(post.content),
            "updated_at": post.updated_at.isoformat() if post.updated_at else None,
        }

    @tool
    def save_draft_post(content: str, platform: str = "x") -> dict[str, Any]:
        """Persist a BRAND NEW post draft to PostgreSQL ONLY when the user asks to start a new post from scratch.
        CRITICAL: DO NOT use this tool if the user is asking to modify, shorten, lengthen, rephrase, critique, or update an existing post. For ANY modifications to an existing draft, you MUST use update_draft_post instead.
        Calling this tool automatically renders the native interactive post component in the chat interface.
        IMPORTANT: In your final assistant response, DO NOT repeat, quote, or re-paste the post content. The component already renders it. Simply state that the draft has been created or provide a brief 1-sentence strategic note.
        """
        post = raw_save_draft_post(
            user_id=user_id, content=content, platform=platform, session=session
        )
        if not post:
            return {"error": "Failed to save post draft to database"}

        if thread_id:
            try:
                t_uuid = uuid.UUID(thread_id)
                thread = session.get(ChatThread, t_uuid)
                if thread:
                    thread.post_id = post.id
                    session.add(thread)
                    session.commit()
            except Exception as exc:
                logger.debug(f"Failed to link post to thread: {exc}")

        return {
            "post_id": str(post.id),
            "id": str(post.id),
            "postId": str(post.id),
            "content": post.content,
            "platform": post.platform,
            "status": post.status,
            "char_count": len(post.content),
            "ui_rendered": True,
            "instruction": "The post is now rendered as an interactive post component in the chat. Do NOT repeat or output the post content in your text reply.",
        }

    @tool
    def update_draft_post(
        refined_content: str, post_id: str | None = None
    ) -> dict[str, Any]:
        """Update an existing draft post in PostgreSQL with refined content.
        ALWAYS call this tool when the user gives feedback on a post, asks for changes, tone adjustments,
        shortening, lengthening, adding/removing emojis or hashtags, or comments on the draft.
        DO NOT call save_draft_post for revisions—use this tool so the same post is edited in-place.
        If post_id is omitted or not known, it automatically targets the active draft in this thread.
        IMPORTANT: In your final assistant response, DO NOT repeat or re-paste the post content.
        The UI component will update and display it automatically. Keep your reply to 1 concise sentence.
        """
        target_post = _resolve_target_post(post_id=post_id)
        if not target_post:
            created = raw_save_draft_post(
                user_id=user_id,
                content=refined_content,
                platform="x",
                session=session,
            )
            if not created:
                return {"error": "Failed to update or create draft post"}
            if thread_id:
                try:
                    t_uuid = uuid.UUID(thread_id)
                    thread = session.get(ChatThread, t_uuid)
                    if thread:
                        thread.post_id = created.id
                        session.add(thread)
                        session.commit()
                except Exception as exc:
                    logger.debug(f"Could not link post to thread: {exc}")
            return {
                "post_id": str(created.id),
                "id": str(created.id),
                "postId": str(created.id),
                "content": created.content,
                "platform": created.platform,
                "status": created.status,
                "char_count": len(created.content),
                "updated": True,
                "ui_rendered": True,
                "instruction": "The post has been created/updated as an interactive component in the chat. Do NOT repeat or output the post content in your text reply.",
            }

        post = raw_update_post_in_db(
            post_id=str(target_post.id),
            user_id=user_id,
            content=refined_content,
            session=session,
        )
        if not post:
            return {"error": f"Failed to update post with ID {target_post.id}"}

        if thread_id:
            try:
                t_uuid = uuid.UUID(thread_id)
                thread = session.get(ChatThread, t_uuid)
                if thread and thread.post_id != post.id:
                    thread.post_id = post.id
                    session.add(thread)
                    session.commit()
            except Exception as exc:
                logger.debug(f"Could not link updated post to thread: {exc}")

        return {
            "post_id": str(post.id),
            "id": str(post.id),
            "postId": str(post.id),
            "content": post.content,
            "platform": post.platform,
            "status": post.status,
            "char_count": len(post.content),
            "updated": True,
            "ui_rendered": True,
            "instruction": "The updated post is now rendered as an interactive post component in the chat. Do NOT repeat or output the post content in your text reply.",
        }

    @tool
    def schedule_post_in_db(
        scheduled_at_iso: str, post_id: str | None = None
    ) -> dict[str, Any]:
        """Schedule an existing draft post for future publication at the specified ISO timestamp."""
        try:
            target_post = _resolve_target_post(post_id=post_id)
            if not target_post:
                return {"error": "No post found to schedule"}

            scheduled_dt = datetime.fromisoformat(scheduled_at_iso)
            if scheduled_dt.tzinfo is None:
                scheduled_dt = scheduled_dt.replace(tzinfo=timezone.utc)

            post_in = PostUpdate(status="scheduled", scheduled_at=scheduled_dt)
            updated = crud.update_post(
                session=session, db_post=target_post, post_in=post_in
            )
            return {
                "post_id": str(updated.id),
                "id": str(updated.id),
                "postId": str(updated.id),
                "status": updated.status,
                "scheduled_at": updated.scheduled_at.isoformat()
                if updated.scheduled_at
                else None,
            }
        except Exception as e:
            return {"error": f"Failed to schedule post: {e}"}

    return [
        get_latest_scraped_trends,
        get_topic_tweets_and_summary,
        get_recent_post_history,
        get_social_account_status,
        scrape_live_explore_trends,
        scrape_topic_timeline,
        draft_social_post,
        validate_post_constraints,
        get_latest_draft_post,
        save_draft_post,
        update_draft_post,
        schedule_post_in_db,
    ]


def build_copilot_agent(
    *,
    user_id: str,
    session: Session,
    model: str | None = None,
    thread_id: str | None = None,
) -> Any:
    """Compile a LangGraph ReAct agent equipped with LinkX tools."""
    chat_model = get_chat_model(model=model, streaming=True)
    tools = build_copilot_tools(
        user_id=user_id,
        session=session,
        thread_id=thread_id,
    )
    prompt_text = COPILOT_AGENT_SYSTEM_PROMPT

    # Dynamically inject active draft context if available for this thread/user
    try:
        user_uuid = uuid.UUID(user_id)
        target_post: Post | None = None
        if thread_id:
            try:
                t_uuid = uuid.UUID(thread_id)
                thread = session.get(ChatThread, t_uuid)
                if thread and thread.post_id:
                    target_post = crud.get_post(session=session, post_id=thread.post_id)
            except Exception:
                pass
        if not target_post:
            statement = (
                select(Post)
                .where(Post.owner_id == user_uuid, Post.status == "draft")
                .order_by(col(Post.updated_at).desc().nulls_last())
            )
            target_post = session.exec(statement).first()

        if target_post:
            prompt_text += (
                f"\n\n### ACTIVE DRAFT IN THIS CONVERSATION:\n"
                f"- Post ID: {target_post.id}\n"
                f"- Platform: {target_post.platform}\n"
                f"- Current Content:\n```\n{target_post.content}\n```\n"
                f"When the user references 'this post', 'the draft', asks for revisions, or says 'make this more controversial', "
                f'this is the draft to modify. NEVER ask the user for the draft text or ID. Directly call update_draft_post(post_id="{target_post.id}", refined_content=...)!'
            )
    except Exception as exc:
        logger.debug(f"Could not inject active post context into agent: {exc}")

    return create_react_agent(
        model=chat_model,
        tools=tools,
        prompt=SystemMessage(content=prompt_text),
    )
