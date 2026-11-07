"""Generate one ordinary agent answer from a frozen browser reference."""

import asyncio
from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass, replace
from typing import Any, Literal
from uuid import UUID

from sqlmodel import Session

from app.core.db import engine
from app.observation.schemas import BrowserContext
from app.services.agentic.agent_supervisor import BotContext, build_bot_agent
from app.services.agentic.browser_agent import BrowserAgentPolicy
from app.services.ai_chat_runner import stream_agent_events
from app.services.ai_prompt_builder import build_message_history


@dataclass(frozen=True)
class BrowserAnswerRequest:
    owner_id: UUID
    thread_id: UUID
    message: str
    model: str
    context: BrowserContext
    history: list[dict[str, Any]]
    insufficient: bool = False
    answer_basis: Literal["browser", "mixed", "conversation", "general"] = "browser"


async def stream_browser_answer(
    *, request: BrowserAnswerRequest, cancelled: Callable[[], bool]
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    """Use the normal agent/tools/event parser, with no alternate answer fallback."""
    transcript = {"messages": request.history}
    messages = build_message_history(
        transcript=transcript, current_message=request.message, model=request.model
    )[1:]
    policy = BrowserAgentPolicy(
        context=request.context,
        message=request.message,
        model=request.model,
        insufficient=request.insufficient,
        answer_basis=request.answer_basis,
        cancelled=cancelled,
    )
    options = policy.options()
    prepare = options.prepare_messages
    assert prepare is not None
    with Session(engine) as session:

        def prepare_without_transaction(*, messages: Any, tools: Any) -> Any:
            session.rollback()
            return prepare(messages=messages, tools=tools)

        options = replace(options, prepare_messages=prepare_without_transaction)
        agent = build_bot_agent(
            ctx=BotContext(
                user_id=str(request.owner_id),
                session=session,
                thread_id=str(request.thread_id),
                transcript=transcript,
            ),
            model=request.model,
            options=options,
        )
        session.rollback()
        agent = agent.with_config({"recursion_limit": 12})
        async for event, data in stream_agent_events(
            agent=agent, messages=messages, promote_thought_fallback=False
        ):
            if cancelled():
                raise asyncio.CancelledError
            # No raw provider reasoning or tagged private trace becomes answer data.
            if event != "thought":
                yield event, data
