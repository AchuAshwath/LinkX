"""Run the real browser-reading API with a deterministic local model provider.

This harness deliberately preserves normal authentication, persistence, broker,
and question-runner behavior. Only the model provider is replaced.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import Mapping
from typing import Any

# Avoid scheduler side effects before importing settings or the application.
os.environ["SCHEDULER_ENABLED"] = "false"
os.environ["FRONTEND_HOST"] = os.environ.get(
    "READING_SMOKE_BASE", "http://127.0.0.1:4001"
)

logger = logging.getLogger("observation_system_harness")
INVALID_READINESS: dict[str, Any] = {
    "decision": "answer",
    "evidence_ids": [],
    "answer_basis": "browser",
    "requires_complete": False,
}


class ScriptedProvider:
    """Deterministic provider that logs operation names, never page content."""

    def __init__(self) -> None:
        self._calls = 0
        self.active_reads = 0
        self.read_calls = 0

    async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
        del config  # The harness must not inspect or expose configured credentials.
        self._calls += 1
        operation = _operation_for(payload=payload)
        logger.info("scripted provider call=%d operation=%s", self._calls, operation)

        if operation == "read":
            self.active_reads += 1
            self.read_calls += 1
            try:
                await asyncio.sleep(
                    min(
                        30,
                        max(0, float(os.environ.get("READING_SMOKE_READ_DELAY", "6"))),
                    )
                )
                return _read_result()
            finally:
                self.active_reads -= 1
        if operation == "compact":
            return json.dumps(
                {
                    "summary": (
                        "Controlled shared page: badge P2R7; water moon-basil "
                        "after sunset."
                    )
                }
            )
        await asyncio.sleep(
            min(
                10, max(0, float(os.environ.get("READING_SMOKE_EVALUATION_DELAY", "0")))
            )
        )
        return _readiness_result(payload=payload)


def _read_result() -> str:
    return json.dumps(
        {
            "text": (
                "Controlled shared page. Badge P2R7; water moon-basil after sunset."
            ),
            "uncertainty": "",
        }
    )


def _operation_for(*, payload: Mapping[str, Any]) -> str:
    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages:
        return "evaluation"
    first = messages[0]
    if not isinstance(first, Mapping):
        return "evaluation"
    prompt = first.get("content")
    if not isinstance(prompt, str):
        return "evaluation"
    from app.observation.model import READ_SYSTEM_PROMPT

    if prompt == READ_SYSTEM_PROMPT:
        return "read"
    if prompt.startswith("Compact the supplied browser summary"):
        return "compact"
    return "evaluation"


def _readiness_result(*, payload: Mapping[str, Any]) -> str:
    data = _evaluation_data(payload=payload)
    if data.get("message") == "Exercise invalid browser evaluation":
        return json.dumps(INVALID_READINESS)
    return json.dumps(_readiness_payload(data=data))


def _readiness_payload(*, data: Mapping[str, Any]) -> dict[str, Any]:
    message = data.get("message", "")
    context = data.get("browser_context", {})
    pending = context.get("pending_frames", [])
    if isinstance(pending, list) and pending:
        return _read_next_payload()
    if message == "Explain Python tuples in one sentence.":
        return _general_ready_payload()
    return _notes_ready_payload(context=context)


def _read_next_payload() -> dict[str, Any]:
    return {
        "decision": "read_next",
        "evidence_ids": [],
        "requires_complete": False,
        "answer_basis": "browser",
    }


def _general_ready_payload() -> dict[str, Any]:
    return {
        "decision": "ready",
        "evidence_ids": [],
        "requires_complete": False,
        "answer_basis": "general",
    }


def _notes_ready_payload(*, context: Mapping[str, Any]) -> dict[str, Any]:
    notes = context.get("notes", [])
    if not isinstance(notes, list) or not notes:
        return {
            "decision": "insufficient",
            "evidence_ids": [],
            "requires_complete": False,
            "answer_basis": "browser",
        }
    first_note = notes[0]
    note_id = first_note.get("id", "") if isinstance(first_note, Mapping) else ""
    return {
        "decision": "ready",
        "evidence_ids": [note_id] if isinstance(note_id, str) and note_id else [],
        "requires_complete": False,
        "answer_basis": "browser",
    }


def _evaluation_data(*, payload: Mapping[str, Any]) -> Mapping[str, Any]:
    messages = payload.get("messages")
    if not isinstance(messages, list) or len(messages) < 2:
        return {}
    user_message = messages[1]
    if not isinstance(user_message, Mapping):
        return {}
    content = _user_content(user_message=user_message)
    if not isinstance(content, str):
        return {}
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(data, Mapping):
        return {}
    return data


def _user_content(*, user_message: Mapping[str, Any]) -> Any:
    content = user_message.get("content")
    if isinstance(content, list):
        content = next(
            (
                part.get("text")
                for part in content
                if isinstance(part, Mapping) and part.get("type") == "text"
            ),
            None,
        )
    return content


async def _scripted_thread_title(
    *, user_prompt: str, assistant_response: str, model: str | None = None
) -> str:
    del user_prompt, assistant_response, model
    await asyncio.sleep(1)
    return "Shared Page Details"


def main() -> None:
    import uvicorn

    from app.api.routes import ai_browser_chat, ai_observation, ai_threads
    from app.main import app
    from app.observation.model import BrowserModel
    from app.services.agentic import agent_supervisor
    from tests.observation.streaming_provider import ScriptedAnswerProvider

    class SystemAnswerProvider(ScriptedAnswerProvider):
        async def _respond(self, request: Any) -> Any:
            messages = json.loads(request.content).get("messages", [])
            latest = messages[-1].get("content", "") if messages else ""
            serialized = json.dumps(latest, ensure_ascii=False)
            await asyncio.sleep(
                min(
                    5,
                    max(0, float(os.environ.get("READING_SMOKE_ANSWER_DELAY", "2.5"))),
                )
            )
            if "Explain Python tuples in one sentence." in serialized:
                self.answer = "Python tuples are immutable sequences."
            elif "Summarize everything including the shared badge" in serialized:
                self.answer = "The badge is P2R7. Water moon-basil after sunset."
            else:
                self.answer = "The badge is P2R7."
            return await super()._respond(request)

    scripted = ScriptedProvider()
    model = BrowserModel(provider=scripted)
    answers = SystemAnswerProvider()
    agent_supervisor.get_chat_model = answers.model  # type: ignore[attr-defined]

    @app.get("/__test__/provider-state", include_in_schema=False, tags=["test"])
    async def provider_state() -> dict[str, Any]:
        return {"answer_requests": answers.requests}

    @app.get("/__test__/provider-idle", include_in_schema=False, tags=["test"])
    async def provider_idle() -> dict[str, int]:
        return {
            "active_reads": scripted.active_reads,
            "read_calls": scripted.read_calls,
        }

    ai_observation.browser_model = model
    ai_browser_chat.browser_model = model
    ai_threads.generate_ai_thread_title = _scripted_thread_title
    port = int(os.environ.get("READING_SMOKE_API_PORT", "8001"))
    logger.info("starting scripted observation server on 127.0.0.1:%d", port)
    uvicorn.run(app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
