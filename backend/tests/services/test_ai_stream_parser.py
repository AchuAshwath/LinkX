from collections.abc import AsyncGenerator

import pytest

from app.services.ai_stream_parser import (
    recover_unclosed_thought_at_eof,
    stream_parsed_chunks,
    stream_text_smoothly,
)


@pytest.mark.anyio
async def test_stream_text_smoothly() -> None:
    text = "LinkX Bot stream test"
    events: list[tuple[str, str]] = []
    async for ev, data in stream_text_smoothly(text, delay=0):
        events.append((ev, data["content"]))

    assert len(events) == 4
    assert "".join(d for _, d in events) == text
    assert all(ev == "text_delta" for ev, _ in events)


@pytest.mark.anyio
async def test_stream_parsed_chunks_normal_closed_thought() -> None:
    async def sample_chunks() -> AsyncGenerator[str, None]:
        yield "<thought>"
        yield "Step 1: Brainstorming hooks\n"
        yield "Step 2: CTA outline</thought>\n\n"
        yield "Here is the finalized LinkedIn post."

    events = []
    async for ev, data in stream_parsed_chunks(sample_chunks(), delay=0):
        events.append((ev, data))

    thoughts = [d["content"] for ev, d in events if ev == "thought"]
    text_deltas = [d["content"] for ev, d in events if ev == "text_delta"]

    assert "Step 1: Brainstorming hooks" in "".join(thoughts)
    assert "Step 2: CTA outline" in "".join(thoughts)
    assert "".join(text_deltas).strip() == "Here is the finalized LinkedIn post."


@pytest.mark.anyio
async def test_stream_parsed_chunks_unclosed_thought_transition_to_text() -> None:
    """Issue #129: Detect unclosed thinking block when text output begins without </thought>."""

    async def sample_chunks() -> AsyncGenerator[str, None]:
        yield "<thought>1. Angle: thought leadership\n2. Tone: energetic\n\n"
        yield "Here is your viral post draft for LinkedIn:\n🚀 Launch day is here!"

    events = []
    async for ev, data in stream_parsed_chunks(sample_chunks(), delay=0):
        events.append((ev, data))

    thoughts = [d["content"] for ev, d in events if ev == "thought"]
    text_deltas = [d["content"] for ev, d in events if ev == "text_delta"]

    combined_thought = "".join(thoughts)
    combined_text = "".join(text_deltas)

    assert "1. Angle: thought leadership" in combined_thought
    assert "2. Tone: energetic" in combined_thought
    assert "Here is your viral post draft" in combined_text
    assert "🚀 Launch day is here!" in combined_text
    assert "Here is your viral post draft" not in combined_thought


@pytest.mark.anyio
async def test_stream_parsed_chunks_unclosed_thought_at_eof() -> None:
    """Issue #129: If LLM emits <thought> but fails to close before EOF, recover assistant text."""

    async def sample_chunks() -> AsyncGenerator[str, None]:
        yield "<thought>"
        yield "Here is the post drafted directly without closing tag."

    events = []
    async for ev, data in stream_parsed_chunks(sample_chunks(), delay=0):
        events.append((ev, data))

    text_deltas = [d["content"] for ev, d in events if ev == "text_delta"]
    assert "Here is the post drafted directly without closing tag." in "".join(
        text_deltas
    )


@pytest.mark.anyio
async def test_stream_parsed_chunks_unclosed_thought_split_at_eof() -> None:
    """Issue #129: Split thought and text cleanly at EOF when newline boundary is present."""

    async def sample_chunks() -> AsyncGenerator[str, None]:
        yield "<thought>Strategy: keep it punchy\n\nMastering agentic workflows in 2026."

    events = []
    async for ev, data in stream_parsed_chunks(sample_chunks(), delay=0):
        events.append((ev, data))

    thoughts = [d["content"] for ev, d in events if ev == "thought"]
    text_deltas = [d["content"] for ev, d in events if ev == "text_delta"]

    assert "Strategy: keep it punchy" in "".join(thoughts)
    assert "Mastering agentic workflows in 2026." in "".join(text_deltas)


@pytest.mark.anyio
async def test_stream_parsed_chunks_plain_text_without_thoughts() -> None:
    async def sample_chunks() -> AsyncGenerator[str, None]:
        yield "Plain response without "
        yield "any thought tags."

    events = []
    async for ev, data in stream_parsed_chunks(sample_chunks(), delay=0):
        events.append((ev, data))

    thoughts = [d["content"] for ev, d in events if ev == "thought"]
    text_deltas = [d["content"] for ev, d in events if ev == "text_delta"]

    assert len(thoughts) == 0
    assert "".join(text_deltas) == "Plain response without any thought tags."


def test_recover_unclosed_thought_at_eof_helper() -> None:
    # Not in thought: plain text
    res = recover_unclosed_thought_at_eof(buffer="hello world", in_thought=False)
    assert res == [("text_delta", "hello world")]

    # In thought with double newline split
    res2 = recover_unclosed_thought_at_eof(
        buffer="thought notes\n\nactual post", in_thought=True
    )
    assert res2 == [("thought", "thought notes"), ("text_delta", "actual post")]

    # In thought with plain text
    res3 = recover_unclosed_thought_at_eof(buffer="actual post", in_thought=True)
    assert res3 == [("text_delta", "actual post")]


@pytest.mark.anyio
async def test_stream_parsed_chunks_character_by_character_no_bracket_leak() -> None:
    """Adversarial Test: 1-char streaming across tags must never leak closing bracket into text_delta."""

    async def single_char_chunks() -> AsyncGenerator[str, None]:
        for ch in "<thought>Formulating key points</thought>Here is the clean text!":
            yield ch

    events = []
    async for ev, data in stream_parsed_chunks(single_char_chunks(), delay=0):
        events.append((ev, data["content"]))

    thought_content = "".join(c for ev, c in events if ev == "thought")
    text_content = "".join(c for ev, c in events if ev == "text_delta")

    assert thought_content == "Formulating key points"
    assert text_content == "Here is the clean text!"
    assert not text_content.startswith(">")


@pytest.mark.anyio
async def test_stream_parsed_chunks_multi_paragraph_thought_preserved() -> None:
    """Adversarial Test: Multi-paragraph thoughts must not prematurely break into text on capital words."""

    async def multi_para_chunks() -> AsyncGenerator[str, None]:
        yield "<thought>First, analyze the user's requirements.\n\n"
        yield "Second, evaluate the tone and style preferences."
        yield "</thought>\n\nHere is your drafted LinkedIn post."

    events = []
    async for ev, data in stream_parsed_chunks(multi_para_chunks(), delay=0):
        events.append((ev, data["content"]))

    thought_content = "".join(c for ev, c in events if ev == "thought")
    text_content = "".join(c for ev, c in events if ev == "text_delta")

    assert "First, analyze the user's requirements." in thought_content
    assert "Second, evaluate the tone and style preferences." in thought_content
    assert "</thought>" not in text_content
    assert text_content.strip() == "Here is your drafted LinkedIn post."


@pytest.mark.anyio
async def test_stream_parsed_chunks_dangling_orphaned_close_thought_stripped() -> None:
    """Adversarial Test: Orphaned or duplicate </thought> outside thought block must be discarded."""

    async def chunks_with_orphaned_tag() -> AsyncGenerator[str, None]:
        yield "Initial message before tag </thought> continuing response."

    events = []
    async for ev, data in stream_parsed_chunks(chunks_with_orphaned_tag(), delay=0):
        events.append((ev, data["content"]))

    text_content = "".join(c for ev, c in events if ev == "text_delta")
    assert "</thought>" not in text_content
    assert "Initial message before tag" in text_content
    assert "continuing response." in text_content


@pytest.mark.anyio
async def test_stream_parsed_chunks_whitespace_in_tags_and_variants() -> None:
    """Adversarial Test: Support whitespace variants like </thought > and <thinking>."""

    async def chunks_with_spacing() -> AsyncGenerator[str, None]:
        yield "<thinking >Strategic idea</thinking >The final answer."

    events = []
    async for ev, data in stream_parsed_chunks(chunks_with_spacing(), delay=0):
        events.append((ev, data["content"]))

    thought_content = "".join(c for ev, c in events if ev == "thought")
    text_content = "".join(c for ev, c in events if ev == "text_delta")

    assert "Strategic idea" in thought_content
    assert "The final answer." in text_content


@pytest.mark.anyio
async def test_stream_parsed_chunks_redos_and_long_payload_resilience() -> None:
    """Adversarial Test: Verify parser handles large whitespace and nested content without catastrophic backtracking."""
    large_payload = (
        "<thought>" + (" " * 5000) + "Deep thinking" + ("\n" * 500) + "</thought>Result"
    )

    async def large_stream() -> AsyncGenerator[str, None]:
        yield large_payload

    events = []
    async for ev, data in stream_parsed_chunks(large_stream(), delay=0):
        events.append((ev, data["content"]))

    text_content = "".join(c for ev, c in events if ev == "text_delta")
    assert "Result" in text_content


@pytest.mark.anyio
async def test_stream_parsed_chunks_unclosed_thought_promotes_when_zero_text_delta_emitted() -> (
    None
):
    """Issue #129: When unclosed thought paragraphs end with newlines and EOF is reached,
    parser must not allow all text to be swallowed with 0 text_delta events."""

    async def stream_ending_with_trailing_newlines() -> AsyncGenerator[str, None]:
        yield "<thought>I am formulating the strategy.\n\nI need to think carefully.\n\n"
        yield "The most important habit of successful founders is daily execution.\n\n"
        yield "Focus relentlessly on your core value proposition.\n\n"
        yield "Keep building every single day.\n\n"

    events = []
    async for ev, data in stream_parsed_chunks(
        stream_ending_with_trailing_newlines(), delay=0
    ):
        events.append((ev, data["content"]))

    text_deltas = [c for ev, c in events if ev == "text_delta"]
    assert len(text_deltas) > 0, f"Expected text_delta, but got only: {events}"
    full_text = "".join(text_deltas)
    assert "Keep building every single day." in full_text


@pytest.mark.anyio
async def test_stream_parsed_chunks_single_line_unclosed_thought() -> None:
    """Adversarial Test: Single-line unclosed thought with no newlines must not be swallowed."""

    async def single_line_stream() -> AsyncGenerator[str, None]:
        yield "<thought>Short single line post copy without any newlines"

    events = []
    async for ev, data in stream_parsed_chunks(single_line_stream(), delay=0):
        events.append((ev, data["content"]))

    text_deltas = [c for ev, c in events if ev == "text_delta"]
    assert len(text_deltas) > 0
    full_text = "".join(text_deltas)
    assert "Short single line post copy" in full_text


@pytest.mark.anyio
async def test_stream_parsed_chunks_pure_reasoning_does_not_emit_empty_strings() -> (
    None
):
    """Adversarial Test: Pure reasoning stream with no copy should never emit empty string text deltas."""

    async def pure_reasoning_stream() -> AsyncGenerator[str, None]:
        yield "<thought>I am formulating the strategy.\n\nI need to think carefully."

    events = []
    async for ev, data in stream_parsed_chunks(pure_reasoning_stream(), delay=0):
        events.append((ev, data["content"]))

    # Verify no empty string tokens were yielded
    assert all(len(c) > 0 for _, c in events)
    text_deltas = [c for ev, c in events if ev == "text_delta"]
    assert len(text_deltas) > 0


@pytest.mark.anyio
async def test_stream_parsed_chunks_closed_thought_without_text_does_not_promote_thought_to_text() -> (
    None
):
    """Spec Requirement: When thought tag is properly closed and model ends without post copy,
    internal thoughts must NOT be leaked/promoted into text_delta."""

    async def closed_thought_only_stream() -> AsyncGenerator[str, None]:
        yield "<thought>Internal confidential reasoning only</thought>"

    events = []
    async for ev, data in stream_parsed_chunks(closed_thought_only_stream(), delay=0):
        events.append((ev, data["content"]))

    thoughts = [c for ev, c in events if ev == "thought"]
    text_deltas = [c for ev, c in events if ev == "text_delta"]
    assert "Internal confidential reasoning only" in "".join(thoughts)
    assert len(text_deltas) == 0
