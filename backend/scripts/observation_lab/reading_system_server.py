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

logger = logging.getLogger("observation_system_harness")
FIXED_EVALUATIONS: dict[str, dict[str, Any]] = {
    "Exercise invalid browser evaluation": {
        "decision": "answer",
        "answer": "This unvalidated answer must never be displayed.",
        "answer_basis": "invalid-basis",
    },
    "Explain Python tuples in one sentence.": {
        "decision": "answer",
        "answer": "Python tuples are immutable sequences.",
        "evidence_ids": [],
        "answer_basis": "general",
        "requires_complete": False,
    },
}


class ScriptedProvider:
    """Deterministic provider that logs operation names, never page content."""

    def __init__(self) -> None:
        self._calls = 0

    async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
        del config  # The harness must not inspect or expose configured credentials.
        self._calls += 1
        operation = _operation_for(payload=payload)
        logger.info("scripted provider call=%d operation=%s", self._calls, operation)

        if operation == "read":
            await asyncio.sleep(
                min(30, max(0, float(os.environ.get("READING_SMOKE_READ_DELAY", "6"))))
            )
            return _read_result()
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
        return _evaluation_result(payload=payload)


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


def _evaluation_result(*, payload: Mapping[str, Any]) -> str:
    data = _evaluation_data(payload=payload)
    fixed = FIXED_EVALUATIONS.get(data.get("message", ""))
    if fixed is not None:
        return json.dumps(fixed)
    context = data.get("browser_context", {})
    notes = context.get("notes", [])
    pending = context.get("pending_frames", [])
    if isinstance(notes, list) and notes:
        first_note = notes[0]
        note_id = first_note.get("id", "") if isinstance(first_note, Mapping) else ""
        result = {
            "decision": "answer",
            "answer": "The badge is P2R7. Water moon-basil after sunset.",
            "evidence_ids": [note_id] if isinstance(note_id, str) and note_id else [],
            "requires_complete": False,
            "answer_basis": "browser",
        }
    elif isinstance(pending, list) and pending:
        result = {
            "decision": "wait",
            "answer": "",
            "evidence_ids": [],
            "requires_complete": False,
            "answer_basis": "browser",
        }
    else:
        result = {
            "decision": "insufficient",
            "answer": "No controlled page evidence is available yet.",
            "evidence_ids": [],
            "requires_complete": False,
            "answer_basis": "browser",
        }
    return json.dumps(result)


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

    model = BrowserModel(provider=ScriptedProvider())
    ai_observation.browser_model = model
    ai_browser_chat.browser_model = model
    ai_threads.generate_ai_thread_title = _scripted_thread_title
    logger.info("starting scripted observation server on 127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
