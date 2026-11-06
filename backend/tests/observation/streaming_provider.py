"""Scripted model transports for browser readiness and streamed final answers."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
from langchain_openai import ChatOpenAI


class ReadinessProvider:
    """Return readiness metadata only; final prose is produced by ChatOpenAI."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
        del config
        self.requests.append(payload)
        data = json.loads(payload["messages"][1]["content"])
        context = data["browser_context"]
        notes = context["notes"]
        has_summary = bool(context["summary"])
        if notes or has_summary:
            result = {
                "decision": "ready",
                "evidence_ids": [notes[0]["id"]] if notes else [],
                "answer_basis": "browser",
                "requires_complete": False,
            }
        elif context["pending_frames"]:
            result = {
                "decision": "read_next",
                "evidence_ids": [],
                "answer_basis": "browser",
                "requires_complete": False,
            }
        else:
            result = {
                "decision": "ready",
                "evidence_ids": [],
                "answer_basis": "general",
                "requires_complete": False,
            }
        return json.dumps(result)


class _AnswerStream(httpx.AsyncByteStream):
    def __init__(
        self, *, chunks: list[dict[str, Any]], fail_after_first: bool = False
    ) -> None:
        self._chunks = chunks
        self._fail_after_first = fail_after_first

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for index, chunk in enumerate(self._chunks):
            yield f"data: {json.dumps(chunk)}\n\n".encode()
            if index == 0 and self._fail_after_first:
                raise httpx.ReadError("scripted answer stream failure")
        yield b"data: [DONE]\n\n"

    async def aclose(self) -> None:
        return None


class ScriptedAnswerProvider:
    """Serve OpenAI-compatible answer chunks through `httpx.MockTransport`."""

    def __init__(
        self,
        *,
        answer: str = "A product page.",
        fail_after_first: bool = False,
        chunks: list[dict[str, Any]] | None = None,
        responses: list[list[dict[str, Any]]] | None = None,
    ) -> None:
        self.answer = answer
        self.fail_after_first = fail_after_first
        self.chunks = chunks
        self.responses = responses
        self.requests: list[dict[str, Any]] = []
        self.readiness_requests: list[dict[str, Any]] = []
        self._transport = httpx.MockTransport(self._respond)
        self._client = httpx.AsyncClient(transport=self._transport)

    def model(self, **kwargs: Any) -> ChatOpenAI:
        return ChatOpenAI(
            model=kwargs.get("model", "test-model"),
            api_key="fixture-key",
            base_url="http://model.test/v1",
            max_retries=0,
            streaming=True,
            http_async_client=self._client,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _respond(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        response_index = len(self.requests) - 1
        chunks = self._chunks_for_response(index=response_index)
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            stream=_AnswerStream(
                chunks=chunks,
                fail_after_first=self.fail_after_first,
            ),
        )

    def _chunks_for_response(self, *, index: int) -> list[dict[str, Any]]:
        if self.responses is not None and index < len(self.responses):
            return self.responses[index]
        return self.chunks or _answer_chunks(answer=self.answer)


def _answer_chunks(*, answer: str) -> list[dict[str, Any]]:
    split_at = max(1, len(answer) // 2)
    return [
        _chunk(content=answer[:split_at]),
        _chunk(content=answer[split_at:]),
    ]


def _chunk(*, content: str) -> dict[str, Any]:
    return {
        "id": "scripted-answer",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "test-model",
        "choices": [{"index": 0, "delta": {"content": content}, "finish_reason": None}],
    }
