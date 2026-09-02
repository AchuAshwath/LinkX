import asyncio
import re
from collections.abc import AsyncGenerator
from typing import Any

OPEN_THOUGHT_RE = re.compile(
    r"<(?:thought|thinking|think)(?:>|[\s\n\r>])", re.IGNORECASE
)
CLOSE_THOUGHT_RE = re.compile(r"</(?:thought|thinking|think)>?", re.IGNORECASE)


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


def consume_outside_thought(buffer: str) -> tuple[str, bool, str, bool]:
    """Parse text outside <thought> tags."""
    return consume_tag_buffer(buffer, OPEN_THOUGHT_RE, 12, next_in_thought=True)


def consume_inside_thought(buffer: str) -> tuple[str, bool, str, bool]:
    """Parse text inside <thought> tags."""
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


async def stream_parsed_chunks(
    raw_chunks: AsyncGenerator[str, None],
    *,
    delay: float = 0.015,
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    """Parse streaming raw LLM tokens for <thought> tags and route to thought or text_delta events."""
    in_thought = False
    buffer = ""

    async for chunk in raw_chunks:
        buffer += chunk
        while buffer:
            emitted, is_partial, buffer, in_thought, event_type = process_buffer_step(
                buffer, in_thought
            )
            if emitted:
                async for ev in stream_text_smoothly(
                    emitted, event_type=event_type, delay=delay
                ):
                    yield ev
            if is_partial:
                break

    if buffer:
        final_event = "thought" if in_thought else "text_delta"
        async for ev in stream_text_smoothly(
            buffer, event_type=final_event, delay=delay
        ):
            yield ev
