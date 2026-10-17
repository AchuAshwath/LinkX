"""LangGraph Bot Agent Supervisor with multi-tool capabilities.

Equips the LinkX Bot assistant with the full agentic tool suite:
database queries, live Playwright scraping, LLM post curation, and PostgreSQL persistence.
"""

from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool, tool
from langgraph.prebuilt import create_react_agent
from sqlmodel import Session

from app import crud
from app.models import ChatThread, Post, PostPublic, PostUpdate
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

BOT_AGENT_SYSTEM_PROMPT = """You are LinkX Bot, the social media growth and automation engine for X (formerly Twitter) and LinkedIn.

You have autonomous tools to query the database, scrape live explore feeds, curate social content, validate platform rules, and manage draft posts.

<tone_and_style>
- Direct, concise, and pragmatic. Write like a sharp colleague on Slack, not a corporate chatbot.
- Never open with filler ("Certainly!", "Sure thing!", "I'd be happy to help!").
- Never close with trailing pleasantries ("Let me know if there's anything else!").
- Do not use words: "delve", "tapestry", "testament", "beacon", "supercharge".
- Acknowledge issues in max 1 sentence. No groveling. Focus on resolution.
</tone_and_style>

<thinking_guidelines>
Before drafting content, executing tools, or formulating your response, briefly outline your strategic thinking inside <thought>...</thought> tags. Then execute tool calls or provide your response cleanly outside the tags.
</thinking_guidelines>

<draft_editing_rules>
RULE 1: IN-PLACE EDITING — If the user says ANYTHING about a post (edits, tone tweaks, rewrites, shortening, hashtags, feedback), you MUST call `update_draft_post` to edit the same draft in-place. DO NOT call `save_draft_post` when revising an existing post — that creates duplicates.

RULE 2: NEVER ASK FOR POST TEXT OR ID — The draft content and ID are already in your conversation history and system context. Never reply with "Please paste the post text or share the draft/post ID." Immediately rewrite and call `update_draft_post`.

RULE 3: AUTO-RESOLVE POST ID — If you call `update_draft_post`, you do NOT need to specify `post_id` if you don't have it; it auto-resolves to the active draft in this thread. Only call it ONCE with the final revised copy per turn.

RULE 4: NEW POSTS ONLY — Only call `save_draft_post` when the user explicitly requests a brand new post on an entirely new topic from scratch, NOT when iterating on an existing draft.
</draft_editing_rules>

<no_content_repetition>
When you call `save_draft_post` or `update_draft_post`, the UI automatically renders the post as a native interactive component. NEVER duplicate, quote, or re-paste the post text in your chat response. Keep your text response to a brief 1-sentence summary of what you did. Do NOT write "Here is the post:" or paste post paragraphs.
</no_content_repetition>

<tool_workflows>
1. TRENDING TOPICS ("What's trending?"):
   - Call `get_latest_scraped_trends` first.
   - If `has_today_trends` is False: immediately call `scrape_live_explore_trends` for fresh data.
   - If scraping fails: fall back to cached data, noting the `latest_scrape_date`.
   - Present trends directly in your text as a clean numbered list (title, category, volume, context). No UI widgets.

2. NEW POST ("Draft a post about..."):
   - Fetch topic details via `get_topic_tweets_and_summary` if relevant.
   - Craft high-impact copy with viral hooks and concise formatting.
   - Call `validate_post_constraints` for char limits.
   - Call `save_draft_post` — the UI handles display. Do NOT repeat content.

3. REFINING A POST ("Make it shorter", "Remove hashtags", "Change the hook"):
   - Call `get_latest_draft_post` if needed to inspect current state.
   - Call `update_draft_post` with revised copy. Summarize the change in 1 sentence.

4. ACCOUNT DIAGNOSTICS:
   - Use `get_social_account_status` for connected account queries.
</tool_workflows>
"""


@dataclass(frozen=True)
class BotContext:
    user_id: str
    session: Session
    thread_id: str | None = None
    transcript: dict[str, Any] | None = None
    lock: threading.RLock = field(default_factory=threading.RLock)

    @property
    def user_uuid(self) -> uuid.UUID | None:
        try:
            return uuid.UUID(self.user_id)
        except (ValueError, TypeError):
            return None

    @contextmanager
    def synchronized_session(self) -> Generator[Session, None, None]:
        """Provide thread-safe synchronized access to the shared database session."""
        with self.lock:
            try:
                yield self.session
            except Exception:
                try:
                    self.session.rollback()
                except Exception:
                    pass
                raise


def _resolve_by_post_id(*, ctx: BotContext, post_id: str) -> Post | None:
    if post_id.strip().lower() in ("none", "null", "undefined"):
        return None
    try:
        p_uuid = uuid.UUID(post_id.strip())
        with ctx.synchronized_session() as session:
            post = crud.get_post(session=session, post_id=p_uuid)
            if post and post.owner_id == ctx.user_uuid:
                return post
    except (ValueError, TypeError):
        pass
    return None


def _contains_post_id(*, messages: Any, post_id_str: str) -> bool:
    if not isinstance(messages, list):
        return False
    return any(_extract_id_from_message(msg=m) == post_id_str for m in messages)


def _post_belongs_to_inactive_branch(
    *, thread: ChatThread, active_transcript: dict[str, Any] | None
) -> bool:
    """Check if thread.post_id was created in a sibling branch not on the active path."""
    if not thread.post_id or not active_transcript:
        return False

    target_str = str(thread.post_id)
    if _contains_post_id(
        messages=active_transcript.get("messages"), post_id_str=target_str
    ):
        return False

    all_transcript = thread.transcript if isinstance(thread.transcript, dict) else {}
    return _contains_post_id(
        messages=all_transcript.get("messages"), post_id_str=target_str
    )


def _resolve_by_thread_id(*, ctx: BotContext) -> Post | None:
    if not ctx.thread_id:
        return None
    try:
        t_uuid = uuid.UUID(ctx.thread_id)
        with ctx.synchronized_session() as session:
            thread = session.get(ChatThread, t_uuid)
            if not thread or not thread.post_id:
                return None
            if _post_belongs_to_inactive_branch(
                thread=thread, active_transcript=ctx.transcript
            ):
                return None
            post = crud.get_post(session=session, post_id=thread.post_id)
            if post and post.owner_id == ctx.user_uuid:
                return post
    except Exception as exc:
        logger.debug("Could not load thread post: %s", exc)
    return None


def _extract_from_artifact_part(*, part: dict[str, Any]) -> str | None:
    if part.get("type") != "draft_artifact":
        return None
    raw_artifact = part.get("artifact")
    artifact: dict[str, Any] = raw_artifact if isinstance(raw_artifact, dict) else {}
    p_id = part.get("post_id") or artifact.get("postId") or artifact.get("id")
    return str(p_id) if p_id else None


def _extract_from_tool_call_part(*, part: dict[str, Any]) -> str | None:
    if part.get("type") not in ("tool-call", "tool_call"):
        return None
    raw_tool = part.get("tool")
    tool_val: dict[str, Any] = raw_tool if isinstance(raw_tool, dict) else {}
    name = part.get("name") or tool_val.get("name")
    if name not in ("save_draft_post", "update_draft_post"):
        return None
    raw_output = part.get("output") or tool_val.get("output")
    if not isinstance(raw_output, dict):
        return None
    p_id = raw_output.get("post_id") or raw_output.get("id") or raw_output.get("postId")
    return str(p_id) if p_id else None


def _extract_id_from_part(*, part: Any) -> str | None:
    if not isinstance(part, dict):
        return None
    return _extract_from_artifact_part(part=part) or _extract_from_tool_call_part(
        part=part
    )


def _extract_id_from_message(*, msg: Any) -> str | None:
    if not isinstance(msg, dict):
        return None
    parts = msg.get("parts")
    if not isinstance(parts, list):
        return None
    for part in reversed(parts):
        p_id = _extract_id_from_part(part=part)
        if p_id:
            return p_id
    return None


def _extract_draft_id_from_transcript(
    *,
    transcript: dict[str, Any] | None,
) -> str | None:
    if not isinstance(transcript, dict):
        return None
    messages = transcript.get("messages")
    if not isinstance(messages, list):
        return None
    for msg in reversed(messages):
        p_id = _extract_id_from_message(msg=msg)
        if p_id:
            return p_id
    return None


def _resolve_target_post(*, ctx: BotContext, post_id: str | None = None) -> Post | None:
    """Resolve target post scoped strictly to explicit ID, active branch, or thread."""
    if not ctx.user_uuid:
        return None

    clean_post_id = (post_id or "").strip()
    if clean_post_id:
        return _resolve_by_post_id(ctx=ctx, post_id=clean_post_id)

    target_id = _extract_draft_id_from_transcript(transcript=ctx.transcript)
    resolved = _resolve_by_post_id(ctx=ctx, post_id=target_id) if target_id else None
    return resolved or _resolve_by_thread_id(ctx=ctx)


def _link_post_to_thread(*, ctx: BotContext, post_id: uuid.UUID | None) -> None:
    if not ctx.thread_id or not post_id:
        return
    try:
        t_uuid = uuid.UUID(ctx.thread_id)
        with ctx.synchronized_session() as session:
            thread = session.get(ChatThread, t_uuid)
            if thread and thread.post_id != post_id:
                thread.post_id = post_id
                session.add(thread)
                session.commit()
    except Exception as exc:
        logger.debug("Could not link post to thread: %s", exc)


def _build_trend_tools(ctx: BotContext) -> list[BaseTool]:
    """Build trending topic inspection tools."""

    @tool
    def get_latest_scraped_trends(limit: int = 10) -> dict[str, Any]:
        """Query recent trending topics from LinkX database."""
        try:
            assert ctx.user_uuid is not None
            with ctx.synchronized_session() as session:
                topics = crud.get_latest_trending_topics(
                    session=session, user_id=ctx.user_uuid, limit=limit
                )
            today_utc = datetime.now(timezone.utc).date()
            has_today = False
            latest_str = None
            if topics:
                latest_dt = topics[0].last_seen_at or topics[0].created_at
                if latest_dt:
                    dt_val = (
                        latest_dt.date() if hasattr(latest_dt, "date") else latest_dt
                    )
                    latest_str = dt_val.isoformat()
                    has_today = dt_val >= today_utc

            items = [
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
                "has_today_trends": has_today,
                "latest_scrape_date": latest_str,
                "today_date": today_utc.isoformat(),
                "count": len(items),
                "topics": items,
            }
        except Exception as e:
            logger.error("Error in get_latest_scraped_trends: %s", e)
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
        """Retrieve topic tweets and Grok summary for a topic ID."""
        with ctx.synchronized_session() as session:
            res = raw_get_topic_tweets_and_summary(
                topic_id=topic_id, max_tweets=max_tweets, session=session
            )
        return res.model_dump() if res else None

    return [get_latest_scraped_trends, get_topic_tweets_and_summary]


def _build_context_tools(ctx: BotContext) -> list[BaseTool]:
    """Build context and account status tools."""

    @tool
    def get_recent_post_history(limit: int = 5) -> list[dict[str, Any]]:
        """Retrieve the user's recently published posts."""
        with ctx.synchronized_session() as session:
            posts = raw_get_recent_post_history(
                user_id=ctx.user_id, limit=limit, session=session
            )
        return [p.model_dump() for p in posts]

    @tool
    def get_social_account_status() -> dict[str, Any]:
        """Check user's X.com and LinkedIn account connection status."""
        with ctx.synchronized_session() as session:
            res = raw_get_social_account_status(user_id=ctx.user_id, session=session)
        return res.model_dump()

    return [get_recent_post_history, get_social_account_status]


def _build_scraping_tools(ctx: BotContext) -> list[BaseTool]:
    """Build live web perception tools."""

    @tool
    async def scrape_live_explore_trends(
        max_topics: int = 3,
        config: RunnableConfig = ...,  # type: ignore[assignment]
    ) -> dict[str, Any]:
        """Scrape fresh trending topics directly from X.com Explore."""
        bounded_max_topics = min(max(1, max_topics), 3)
        raw_result = await raw_scrape_live_explore_trends(
            user_id=ctx.user_id,
            max_topics=bounded_max_topics,
            headless=True,
            session=ctx.session,
            config=config,
        )
        try:
            assert ctx.user_uuid is not None
            with ctx.synchronized_session() as session:
                fresh = crud.get_latest_trending_topics(
                    session=session,
                    user_id=ctx.user_uuid,
                    limit=bounded_max_topics,
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
                for t in fresh
            ]
        except Exception as e:
            logger.debug("Could not load fresh topics: %s", e)
            raw_result["topics"] = []
        return raw_result

    @tool
    async def scrape_topic_timeline(
        topic_url: str, max_tweets: int = 5
    ) -> dict[str, Any]:
        """Scrape topic timeline tweets and summary from live X."""
        return await raw_scrape_topic_timeline(
            topic_url=topic_url, user_id=ctx.user_id, max_tweets=max_tweets
        )

    return [scrape_live_explore_trends, scrape_topic_timeline]


def _build_curation_tools() -> list[BaseTool]:
    """Build content generation and validation tools."""

    @tool
    async def draft_social_post(
        prompt: str, platform: str = "linkx", topic_context: str | None = None
    ) -> dict[str, Any]:
        """Generate high-engagement social media post copy."""
        text = await raw_draft_social_post(
            topic_title=prompt, topic_summary=topic_context, platform=platform
        )
        return {"content": text, "platform": platform, "char_count": len(text)}

    @tool
    def validate_post_constraints(content: str, platform: str = "x") -> dict[str, Any]:
        """Validate character limits and formatting compliance."""
        res = raw_validate_post_constraints(content=content, platform=platform)
        return res.model_dump()

    return [draft_social_post, validate_post_constraints]


def _format_post_card(
    *, post: Post | PostPublic, updated: bool = False
) -> dict[str, Any]:
    """Format standard post dictionary for chat UI rendering."""
    return {
        "post_id": str(post.id),
        "id": str(post.id),
        "postId": str(post.id),
        "content": post.content,
        "platform": post.platform,
        "status": post.status,
        "char_count": len(post.content),
        "updated": updated,
        "ui_rendered": True,
        "instruction": "The post is rendered as an interactive component in chat. Do NOT repeat or output post content in your text reply.",
    }


def _build_get_latest_draft_tool(ctx: BotContext) -> BaseTool:
    @tool
    def get_latest_draft_post() -> dict[str, Any]:
        """Retrieve the current active draft post."""
        with ctx.synchronized_session():
            post = _resolve_target_post(ctx=ctx)
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

    return get_latest_draft_post


def _build_save_draft_tool(ctx: BotContext) -> BaseTool:
    @tool
    def save_draft_post(content: str, platform: str = "x") -> dict[str, Any]:
        """Persist a BRAND NEW post draft to PostgreSQL."""
        with ctx.synchronized_session() as session:
            post = raw_save_draft_post(
                user_id=ctx.user_id,
                content=content,
                platform=platform,
                session=session,
            )
            if not post:
                return {"error": "Failed to save post draft to database"}
            _link_post_to_thread(ctx=ctx, post_id=post.id)
            return _format_post_card(post=post)

    return save_draft_post


def _build_update_draft_tool(ctx: BotContext) -> BaseTool:
    @tool
    def update_draft_post(
        refined_content: str, post_id: str | None = None
    ) -> dict[str, Any]:
        """Update an existing draft post in PostgreSQL with refined content."""
        with ctx.synchronized_session() as session:
            target = _resolve_target_post(ctx=ctx, post_id=post_id)
            if not target:
                created = raw_save_draft_post(
                    user_id=ctx.user_id,
                    content=refined_content,
                    platform="x",
                    session=session,
                )
                if not created:
                    return {"error": "Failed to update or create draft post"}
                _link_post_to_thread(ctx=ctx, post_id=created.id)
                return _format_post_card(post=created, updated=True)

            post = raw_update_post_in_db(
                post_id=str(target.id),
                user_id=ctx.user_id,
                content=refined_content,
                session=session,
            )
            if not post:
                return {"error": f"Failed to update post with ID {target.id}"}
            _link_post_to_thread(ctx=ctx, post_id=post.id)
            return _format_post_card(post=post, updated=True)

    return update_draft_post


def _build_schedule_draft_tool(ctx: BotContext) -> BaseTool:
    @tool
    def schedule_post_in_db(
        scheduled_at_iso: str, post_id: str | None = None
    ) -> dict[str, Any]:
        """Schedule an existing draft post for future publication."""
        try:
            with ctx.synchronized_session() as session:
                target = _resolve_target_post(ctx=ctx, post_id=post_id)
                if not target:
                    return {"error": "No post found to schedule"}
                scheduled_dt = datetime.fromisoformat(scheduled_at_iso)
                if scheduled_dt.tzinfo is None:
                    scheduled_dt = scheduled_dt.replace(tzinfo=timezone.utc)
                post_in = PostUpdate(status="scheduled", scheduled_at=scheduled_dt)
                updated = crud.update_post(
                    session=session, db_post=target, post_in=post_in
                )
                return {
                    "post_id": str(updated.id),
                    "id": str(updated.id),
                    "status": updated.status,
                    "scheduled_at": updated.scheduled_at.isoformat()
                    if updated.scheduled_at
                    else None,
                }
        except Exception as e:
            return {"error": f"Failed to schedule post: {e}"}

    return schedule_post_in_db


def _build_draft_tools(ctx: BotContext) -> list[BaseTool]:
    """Build post creation, updating, and scheduling tools."""
    return [
        _build_get_latest_draft_tool(ctx),
        _build_save_draft_tool(ctx),
        _build_update_draft_tool(ctx),
        _build_schedule_draft_tool(ctx),
    ]


def build_bot_tools(
    *,
    ctx: BotContext | None = None,
    user_id: str | None = None,
    session: Session | None = None,
    thread_id: str | None = None,
) -> list[BaseTool]:
    """Construct context-bound tools for the authenticated user and database session."""
    if ctx is not None:
        active_ctx = ctx
    else:
        assert user_id is not None and session is not None
        active_ctx = BotContext(
            user_id=user_id,
            session=session,
            thread_id=thread_id,
        )
    return [
        *_build_trend_tools(active_ctx),
        *_build_context_tools(active_ctx),
        *_build_scraping_tools(active_ctx),
        *_build_curation_tools(),
        *_build_draft_tools(active_ctx),
    ]


def _build_active_draft_prompt(*, ctx: BotContext) -> str:
    """Extract context prompt for active draft post."""
    try:
        target = _resolve_target_post(ctx=ctx)
        if not target:
            return ""
        return (
            f"\n\n### ACTIVE DRAFT IN THIS CONVERSATION:\n"
            f"- Post ID: {target.id}\n"
            f"- Platform: {target.platform}\n"
            f"- Current Content:\n```\n{target.content}\n```\n"
            f'When user refers to draft/post, call update_draft_post(post_id="{target.id}").'
        )
    except Exception as exc:
        logger.debug("Could not inject draft prompt: %s", exc)
        return ""


def build_bot_agent(
    *,
    ctx: BotContext,
    model: str | None = None,
) -> Any:
    """Compile a LangGraph ReAct agent equipped with LinkX tools."""
    chat_model = get_chat_model(model=model, streaming=True)
    tools = build_bot_tools(ctx=ctx)
    prompt_text = BOT_AGENT_SYSTEM_PROMPT + _build_active_draft_prompt(ctx=ctx)

    return create_react_agent(
        model=chat_model,
        tools=tools,
        prompt=SystemMessage(content=prompt_text),
    )


# Legacy aliases for backwards compatibility
COPILOT_AGENT_SYSTEM_PROMPT = BOT_AGENT_SYSTEM_PROMPT
CopilotContext = BotContext
build_copilot_agent = build_bot_agent
build_copilot_tools = build_bot_tools
