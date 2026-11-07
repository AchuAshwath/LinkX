# Streamed tool identity TDD record

Date: 2 November 2026
Scope: transcript-part accumulation for interleaved calls that share a tool
name.

## Red → green

The new public-seam test records two `tool_start` events with name `search` and
distinct IDs (`call-1`, `call-2`), then records the output for `call-1`. Before
the fix, the test failed: reverse name matching selected the newer call, leaving
`call-1` running. This reproduced the case where one call's output could be
attached to another call card and corrupt saved history.

The fix distinguishes output events with an explicit ID from legacy outputs
without one. An explicit ID now matches only the same `toolCallId` (or legacy
nested `tool.id`); tool name is not used as a fallback. When an output has no
ID, the prior name-based matching remains available. A second test preserves
that no-ID compatibility behavior.

## Verification

- Focused identity tests — 2 passed.
- `uv run ruff check app/services/ai_turn_accumulator.py tests/services/test_streamed_tool_identity.py` — passed.
- Identity tests plus ordinary `test_ai_stream_turn.py` and
  `test_ai_chat_runner.py` — 28 passed.

No model calls, database changes, route changes, or external service writes were
used in this fix.
