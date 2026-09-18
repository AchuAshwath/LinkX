import asyncio
import re
from collections.abc import AsyncGenerator
from typing import Any

OPEN_THOUGHT_RE = re.compile(
    r"<\s*(?:thought|thinking|think)(?:>|[\s\n\r>])", re.IGNORECASE
)
CLOSE_THOUGHT_RE = re.compile(r"</\s*(?:thought|thinking|think)\s*>", re.IGNORECASE)

UNCLOSED_THOUGHT_TRANSITION_RE = re.compile(
    r"(?:\n\s*\n)(?=(?:#+\s|[-*]\s|\d+\.\s|```|\*\*|Here\b|Sure\b|Certainly\b|Draft\b|Post\b|LinkedIn\b|X\b|Tweet\b|Option\b|Hook\b|Title\b))",
    re.IGNORECASE,
)

IMMEDIATE_TEXT_START_RE = re.compile(
    r"^\s*(?:#+\s|Here\s+(?:is|are)|Here's|Sure!|Certainly!|Draft:|Post:|LinkedIn:|X:|Tweet:)",
    re.IGNORECASE,
)


async def stream_text_smoothly(
    text: str,
    *,
    event_type: str = "text_delta",
    delay: float = 0.015,
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    """Yield deltas smoothly word-by-word preserving whitespace and formatting."""
    tokens = re.findall(r"\S+\s*|\s+", text) or ([text] if text else [])
    for token in tokens:
        yield (event_type, {"content": token})
        if delay > 0:
            await asyncio.sleep(delay)


def consume_tag_buffer(
    buffer: str,
    tag_regex: re.Pattern[str],
    max_partial_len: int,
    *,
    next_in_thought: bool,
) -> tuple[str, bool, str, bool]:
    """Parse text against tag pattern with partial lookahead."""
    m = tag_regex.search(buffer)
    if m:
        emitted = buffer[: m.start()]
        remainder = buffer[m.end() :]
        if not next_in_thought:
            remainder = remainder.lstrip("\n")
        return emitted, False, remainder, next_in_thought

    last_lt = buffer.rfind("<")
    if last_lt != -1 and len(buffer) - last_lt < max_partial_len:
        return buffer[:last_lt], True, buffer[last_lt:], not next_in_thought

    return buffer, False, "", not next_in_thought


def _is_orphaned_close(
    m_close: re.Match[str] | None, m_open: re.Match[str] | None
) -> bool:
    if not m_close:
        return False
    if not m_open:
        return True
    return m_close.start() < m_open.start()


def consume_outside_thought(buffer: str) -> tuple[str, bool, str, bool]:
    """Parse text outside <thought> tags, discarding any orphaned closing tags."""
    m_open = OPEN_THOUGHT_RE.search(buffer)
    m_close = CLOSE_THOUGHT_RE.search(buffer)
    if _is_orphaned_close(m_close, m_open) and m_close is not None:
        emitted = buffer[: m_close.start()]
        remainder = buffer[m_close.end() :].lstrip("\n")
        return emitted, False, remainder, False
    return consume_tag_buffer(buffer, OPEN_THOUGHT_RE, 15, next_in_thought=True)


def _check_unclosed_thought_boundary(
    buffer: str,
) -> tuple[str, bool, str, bool] | None:
    """Check for immediate text starts, explicit post transitions, or pending thought paragraphs."""
    if CLOSE_THOUGHT_RE.search(buffer):
        return None
    if IMMEDIATE_TEXT_START_RE.search(buffer):
        return "", False, buffer.lstrip("\n"), False

    m_trans = UNCLOSED_THOUGHT_TRANSITION_RE.search(buffer)
    if m_trans:
        emitted = buffer[: m_trans.start()]
        remainder = buffer[m_trans.end() :].lstrip("\n")
        return emitted, False, remainder, False

    if "\n\n" in buffer:
        idx = buffer.rfind("\n\n")
        emitted = buffer[:idx]
        remainder = buffer[idx:]
        return emitted, True, remainder, True

    return None


def consume_inside_thought(buffer: str) -> tuple[str, bool, str, bool]:
    """Parse text inside <thought> tags with unclosed tag recovery."""
    boundary = _check_unclosed_thought_boundary(buffer)
    if boundary is not None:
        return boundary
    return consume_tag_buffer(buffer, CLOSE_THOUGHT_RE, 15, next_in_thought=False)


def process_buffer_step(
    buffer: str, in_thought: bool
) -> tuple[str, bool, str, bool, str]:
    """Process one buffer step. Returns (emitted, is_partial, next_buffer, next_in_thought, event_type)."""
    event_type = "thought" if in_thought else "text_delta"
    if not in_thought:
        emitted, is_partial, next_buf, next_state = consume_outside_thought(buffer)
    else:
        emitted, is_partial, next_buf, next_state = consume_inside_thought(buffer)
    return emitted, is_partial, next_buf, next_state, event_type


def recover_unclosed_thought_at_eof(
    *, buffer: str, in_thought: bool
) -> list[tuple[str, str]]:
    """Synthesize clean transition to assistant text if stream terminates inside <thought>."""
    if not in_thought:
        clean = CLOSE_THOUGHT_RE.sub("", buffer)
        return [("text_delta", clean)] if clean else []
    clean_buf = CLOSE_THOUGHT_RE.sub("", buffer)
    if "\n\n" not in clean_buf:
        return [("text_delta", clean_buf)] if clean_buf else []

    thought_part, text_part = clean_buf.split("\n\n", 1)
    items: list[tuple[str, str]] = []
    if thought_part.strip():
        items.append(("thought", thought_part))
    clean_text = text_part.lstrip("\n")
    if clean_text:
        items.append(("text_delta", clean_text))
    return items


def _consume_chunk(
    *, chunk: str, buffer: str, in_thought: bool
) -> tuple[str, bool, list[tuple[str, str]]]:
    """Process incoming chunk with buffer step loop."""
    curr_buf = buffer + chunk
    events: list[tuple[str, str]] = []
    curr_in_thought = in_thought
    while curr_buf:
        emitted, is_partial, curr_buf, curr_in_thought, ev_type = process_buffer_step(
            curr_buf, curr_in_thought
        )
        if emitted:
            events.append((ev_type, emitted))
        if is_partial:
            break
    return curr_buf, curr_in_thought, events


async def _stream_eof_recovered(
    *, buffer: str, in_thought: bool, delay: float
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    """Emit smoothed recovery events for remaining buffer at stream close."""
    for ev_type, content in recover_unclosed_thought_at_eof(
        buffer=buffer, in_thought=in_thought
    ):
        async for ev in stream_text_smoothly(content, event_type=ev_type, delay=delay):
            yield ev


async def stream_parsed_chunks(
    raw_chunks: AsyncGenerator[str, None],
    *,
    delay: float = 0.015,
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    """Parse streaming raw LLM tokens for <thought> tags and route to thought or text_delta events."""
    in_thought = False
    buffer = ""

    async for chunk in raw_chunks:
        buffer, in_thought, events = _consume_chunk(
            chunk=chunk, buffer=buffer, in_thought=in_thought
        )
        for ev_type, content in events:
            async for ev in stream_text_smoothly(
                content, event_type=ev_type, delay=delay
            ):
                yield ev

    async for ev in _stream_eof_recovered(
        buffer=buffer, in_thought=in_thought, delay=delay
    ):
        yield ev
