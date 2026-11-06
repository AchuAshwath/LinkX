"""Test-only server: hold each synthetic image read until the browser test releases it.

Run from backend: uv run --no-sync python -m scripts.observation_lab.pending_capture_server
Only the provider is scripted; HTTP, capture, broker, evaluation, and saving are real.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os
from typing import Any, Literal

from PIL import Image

LABELS = ("warmup", "first", "second")
NOTES = {
    "warmup": "Welcome page. No access code is shown.",
    "first": "First view: the loading dock opens at nine. No access code is shown.",
    "second": "Second view: the access code is SAPPHIRE-742.",
}
ANSWER = "The access code is SAPPHIRE-742."


def image_label(*, payload: dict[str, Any]) -> str:
    parts = payload["messages"][1]["content"]
    url = next(
        part["image_url"]["url"] for part in parts if part["type"] == "image_url"
    )
    with Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))) as image:
        pixel = image.convert("RGB").getpixel((10, 10))
    if not isinstance(pixel, tuple):
        raise ValueError("Synthetic image marker must be an RGB pixel")
    # The canvas fixture uses a solid red/green/blue marker in the JPEG itself.
    return LABELS[max(range(3), key=lambda index: pixel[index])]


class PendingImageProvider:
    def __init__(self) -> None:
        self.gates = {label: asyncio.Event() for label in LABELS}
        self.events: list[dict[str, Any]] = []
        self.active = 0

    async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
        del config
        schema = payload["response_format"]["json_schema"]["name"]
        if schema == "browser_read":
            return await self.read(payload=payload)
        if schema != "browser_readiness":
            raise AssertionError(f"Unexpected fixture operation: {schema}")
        return self.readiness(payload=payload)

    async def read(self, *, payload: dict[str, Any]) -> str:
        label = image_label(payload=payload)
        self.events.append({"phase": "read_started", "label": label})
        self.active += 1
        try:
            await self.gates[label].wait()
        finally:
            self.active -= 1
        self.events.append({"phase": "read_completed", "label": label})
        return json.dumps({"text": NOTES[label], "uncertainty": ""})

    def readiness(self, *, payload: dict[str, Any]) -> str:
        data = json.loads(payload["messages"][1]["content"])
        context = data["browser_context"]
        matches = [
            note["id"] for note in context["notes"] if note["text"] == NOTES["second"]
        ]
        decision = "ready" if matches else "read_next"
        if not matches and not context["pending_frames"]:
            decision = "insufficient"
        self.events.append({"phase": "readiness", "decision": decision})
        return json.dumps(
            {
                "decision": decision,
                "evidence_ids": matches,
                "answer_basis": "browser",
                "requires_complete": False,
            }
        )


def install_controls(*, app: Any, provider: PendingImageProvider) -> None:
    from fastapi import HTTPException

    @app.get("/__test__/state", include_in_schema=False, tags=["test"])  # type: ignore[untyped-decorator]
    async def state() -> dict[str, Any]:
        return {"events": provider.events, "active": provider.active}

    @app.post("/__test__/release/{label}", include_in_schema=False, tags=["test"])  # type: ignore[untyped-decorator]
    async def release(
        *, label: Literal["warmup", "first", "second"]
    ) -> dict[str, bool]:
        provider.gates[label].set()
        return {"released": True}

    @app.post("/__test__/reset", include_in_schema=False, tags=["test"])  # type: ignore[untyped-decorator]
    async def reset() -> dict[str, bool]:
        if provider.active:
            raise HTTPException(
                status_code=409, detail="A fixture read is still active"
            )
        provider.events.clear()
        provider.gates = {label: asyncio.Event() for label in LABELS}
        return {"reset": True}


def main() -> None:
    os.environ["SCHEDULER_ENABLED"] = "false"
    os.environ["FRONTEND_HOST"] = "http://127.0.0.1:4001"
    import uvicorn

    from app.api.routes import ai_browser_chat, ai_observation, ai_threads
    from app.main import app
    from app.observation.model import BrowserModel
    from app.services.agentic import agent_supervisor
    from tests.observation.streaming_provider import ScriptedAnswerProvider

    async def no_title(**_: Any) -> None:
        return None

    provider = PendingImageProvider()
    model = BrowserModel(provider=provider)
    answers = ScriptedAnswerProvider(answer=ANSWER)
    original_respond = answers._respond

    async def answer_request(request: Any) -> Any:
        # The submitted question is ordinary ChatOpenAI input; the fixture keeps
        # the deterministic answer independent of provider credentials.
        answers.answer = ANSWER
        return await original_respond(request)

    answers._respond = answer_request  # type: ignore[method-assign]
    agent_supervisor.get_chat_model = answers.model  # type: ignore[attr-defined]
    ai_browser_chat.browser_model = model
    ai_observation.browser_model = model
    ai_threads.generate_ai_thread_title = no_title
    install_controls(app=app, provider=provider)
    uvicorn.run(app, host="127.0.0.1", port=8001)


if __name__ == "__main__":
    main()
