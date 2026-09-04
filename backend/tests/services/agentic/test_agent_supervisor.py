"""Tests for LangGraph Copilot Agent Supervisor draft management and in-place editing."""

from __future__ import annotations

import uuid
from typing import Any

from sqlmodel import Session, select

from app import crud
from app.models import ChatThread, ChatThreadCreate, Post, User, UserCreate
from app.services.agentic.agent_supervisor import (
    COPILOT_AGENT_SYSTEM_PROMPT,
    build_copilot_agent,
    build_copilot_tools,
)
from tests.utils.utils import random_email, random_lower_string


def _make_user(*, db: Session) -> User:
    return crud.create_user(
        session=db,
        user_create=UserCreate(
            email=random_email(),
            password=random_lower_string(),
        ),
    )


def _make_thread(
    *, db: Session, user: User, post_id: uuid.UUID | None = None
) -> ChatThread:
    thread_in = ChatThreadCreate(
        title="Test Thread",
        origin="manual",
        post_id=post_id,
    )
    return crud.create_chat_thread(session=db, thread_in=thread_in, owner_id=user.id)


def _get_tool_by_name(tools: list[Any], name: str) -> Any:
    for t in tools:
        if t.name == name:
            return t
    raise ValueError(f"Tool {name} not found")


class TestAgentSupervisorDraftManagement:
    def test_copilot_agent_system_prompt_rules(self) -> None:
        """Verify prompt contains strict rules for in-place editing and no repetition."""
        assert (
            "IN-PLACE DRAFT EDITING VS CREATING NEW DRAFTS"
            in COPILOT_AGENT_SYSTEM_PROMPT
        )
        assert "update_draft_post" in COPILOT_AGENT_SYSTEM_PROMPT
        assert (
            "DO NOT CALL `save_draft_post` WHEN REVISING" in COPILOT_AGENT_SYSTEM_PROMPT
        )
        assert "NO POST CONTENT REPETITION" in COPILOT_AGENT_SYSTEM_PROMPT
        assert "get_latest_draft_post" in COPILOT_AGENT_SYSTEM_PROMPT

    def test_build_copilot_tools_includes_latest_draft_tool(self, db: Session) -> None:
        user = _make_user(db=db)
        tools = build_copilot_tools(user_id=str(user.id), session=db)
        tool_names = [t.name for t in tools]
        assert "get_latest_draft_post" in tool_names
        assert "save_draft_post" in tool_names
        assert "update_draft_post" in tool_names
        assert "schedule_post_in_db" in tool_names

    def test_get_latest_draft_post_empty(self, db: Session) -> None:
        user = _make_user(db=db)
        tools = build_copilot_tools(user_id=str(user.id), session=db)
        get_tool = _get_tool_by_name(tools, "get_latest_draft_post")

        result = get_tool.invoke({})
        assert "No active draft post found" in result["message"]

    def test_save_draft_post_links_to_thread(self, db: Session) -> None:
        user = _make_user(db=db)
        thread = _make_thread(db=db, user=user)
        assert thread.post_id is None

        tools = build_copilot_tools(
            user_id=str(user.id), session=db, thread_id=str(thread.id)
        )
        save_tool = _get_tool_by_name(tools, "save_draft_post")

        result = save_tool.invoke(
            {"content": "A brand new viral tweet!", "platform": "x"}
        )
        assert "post_id" in result
        assert result["content"] == "A brand new viral tweet!"
        assert result["ui_rendered"] is True

        db.refresh(thread)
        assert thread.post_id == uuid.UUID(result["post_id"])

    def test_get_latest_draft_post_returns_thread_linked_post(
        self, db: Session
    ) -> None:
        user = _make_user(db=db)
        thread = _make_thread(db=db, user=user)

        tools = build_copilot_tools(
            user_id=str(user.id), session=db, thread_id=str(thread.id)
        )
        save_tool = _get_tool_by_name(tools, "save_draft_post")
        save_res = save_tool.invoke(
            {"content": "Initial thread draft", "platform": "x"}
        )

        get_tool = _get_tool_by_name(tools, "get_latest_draft_post")
        get_res = get_tool.invoke({})

        assert get_res["post_id"] == save_res["post_id"]
        assert get_res["content"] == "Initial thread draft"

    def test_update_draft_post_edits_same_post_in_place(self, db: Session) -> None:
        user = _make_user(db=db)
        thread = _make_thread(db=db, user=user)

        tools = build_copilot_tools(
            user_id=str(user.id), session=db, thread_id=str(thread.id)
        )
        save_tool = _get_tool_by_name(tools, "save_draft_post")
        initial_res = save_tool.invoke({"content": "First draft text", "platform": "x"})
        initial_post_id = initial_res["post_id"]

        # Now update without specifying post_id (mimicking LLM reacting to user feedback)
        update_tool = _get_tool_by_name(tools, "update_draft_post")
        updated_res = update_tool.invoke(
            {"refined_content": "Second draft text (shorter and punchier)"}
        )

        assert updated_res["post_id"] == initial_post_id
        assert updated_res["content"] == "Second draft text (shorter and punchier)"
        assert updated_res["updated"] is True

        # Ensure NO duplicate post was created in the database
        posts = db.exec(select(Post).where(Post.owner_id == user.id)).all()
        assert len(posts) == 1
        assert posts[0].content == "Second draft text (shorter and punchier)"

    def test_update_draft_post_fallback_when_no_draft_exists(self, db: Session) -> None:
        user = _make_user(db=db)
        thread = _make_thread(db=db, user=user)

        tools = build_copilot_tools(
            user_id=str(user.id), session=db, thread_id=str(thread.id)
        )
        update_tool = _get_tool_by_name(tools, "update_draft_post")

        # When no draft exists at all, update_draft_post gracefully saves it as a new draft
        res = update_tool.invoke(
            {"refined_content": "Draft created via update fallback"}
        )
        assert "post_id" in res
        assert res["content"] == "Draft created via update fallback"

        db.refresh(thread)
        assert thread.post_id == uuid.UUID(res["post_id"])

    def test_schedule_post_auto_resolves_active_draft(self, db: Session) -> None:
        user = _make_user(db=db)
        thread = _make_thread(db=db, user=user)

        tools = build_copilot_tools(
            user_id=str(user.id), session=db, thread_id=str(thread.id)
        )
        save_tool = _get_tool_by_name(tools, "save_draft_post")
        saved = save_tool.invoke(
            {"content": "Post ready for scheduling", "platform": "x"}
        )

        schedule_tool = _get_tool_by_name(tools, "schedule_post_in_db")
        sched_res = schedule_tool.invoke({"scheduled_at_iso": "2026-09-05T15:00:00Z"})

        assert sched_res["post_id"] == saved["post_id"]
        assert sched_res["status"] == "scheduled"

    def test_build_copilot_agent_compilation(self, db: Session) -> None:
        user = _make_user(db=db)
        agent = build_copilot_agent(
            user_id=str(user.id), session=db, thread_id="some-thread-id"
        )
        assert agent is not None

    def test_build_copilot_agent_injects_active_draft_context(
        self, db: Session
    ) -> None:
        user = _make_user(db=db)
        thread = _make_thread(db=db, user=user)

        # Save an active draft
        tools = build_copilot_tools(
            user_id=str(user.id), session=db, thread_id=str(thread.id)
        )
        save_tool = _get_tool_by_name(tools, "save_draft_post")
        save_res = save_tool.invoke(
            {"content": "Draft to be made controversial", "platform": "x"}
        )
        assert "post_id" in save_res

        agent = build_copilot_agent(
            user_id=str(user.id), session=db, thread_id=str(thread.id)
        )
        assert agent is not None
