"""Reject oversized browser requests before JSON/image parsing."""

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_BROWSER_BODY_BYTES = 8 * 1024 * 1024
BODY_LIMIT_DETAIL = "Browser request exceeds size limit"


def _is_browser_request(*, scope: Scope) -> bool:
    if scope.get("type") != "http":
        return False
    if scope.get("method") != "POST":
        return False
    path = scope.get("path", "")
    return path.endswith("/browser-chat") or "/ai/observation/" in path


def _replay_receive(*, body: bytes, receive: Receive) -> Receive:
    delivered = False

    async def replay() -> Message:
        nonlocal delivered
        if not delivered:
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await receive()

    return replay


async def _respond_too_large(*, scope: Scope, receive: Receive, send: Send) -> None:
    response = JSONResponse({"detail": BODY_LIMIT_DETAIL}, status_code=413)
    await response(scope, receive, send)


async def _read_bounded_body(
    *, scope: Scope, receive: Receive, send: Send
) -> bytes | None:
    chunks: list[bytes] = []
    size = 0
    while True:
        message = await receive()
        if message["type"] == "http.disconnect":
            return None
        chunk = message.get("body", b"")
        size += len(chunk)
        if size > MAX_BROWSER_BODY_BYTES:
            await _respond_too_large(scope=scope, receive=receive, send=send)
            return None
        chunks.append(chunk)
        if not message.get("more_body", False):
            return b"".join(chunks)


class BrowserBodyLimit:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not _is_browser_request(scope=scope):
            await self.app(scope, receive, send)
            return
        body = await _read_bounded_body(scope=scope, receive=receive, send=send)
        if body is None:
            return
        await self.app(scope, _replay_receive(body=body, receive=receive), send)
