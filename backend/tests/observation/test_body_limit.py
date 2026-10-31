"""ASGI-boundary tests for the browser request body cap."""

from typing import Any

import pytest
from starlette.types import Message, Receive, Scope, Send

from app.observation.body_limit import BrowserBodyLimit


@pytest.mark.anyio
async def test_chunked_browser_body_without_content_length_gets_413() -> None:
    downstream_calls = 0
    sent: list[Message] = []
    chunks = [
        {
            "type": "http.request",
            "body": b"x" * (8 * 1024 * 1024),
            "more_body": True,
        },
        {"type": "http.request", "body": b"y", "more_body": False},
    ]

    async def receive() -> Message:
        return chunks.pop(0)

    async def send(message: Message) -> None:
        sent.append(message)

    async def downstream(_scope: Scope, _receive: Receive, _send: Send) -> None:
        nonlocal downstream_calls
        downstream_calls += 1

    scope: dict[str, Any] = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/ai/threads/thread-id/browser-chat",
        "headers": [(b"content-type", b"application/json")],
    }

    await BrowserBodyLimit(downstream)(scope, receive, send)

    assert downstream_calls == 0
    assert len(chunks) == 0
    assert sent[0]["type"] == "http.response.start"
    assert sent[0]["status"] == 413
    assert sent[1]["body"] == b'{"detail":"Browser request exceeds size limit"}'
