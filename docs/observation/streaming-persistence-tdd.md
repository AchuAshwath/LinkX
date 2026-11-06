# Streaming persistence TDD notes

Date: 2 November 2026

## Stream turn accumulator

- **Red:** Added a public `StreamTurn` behavior test for ordinary streamed text
  and tool events, while excluding browser notes and `read_browser_context`
  calls. `uv run pytest tests/services/test_ai_stream_turn.py -q` failed at
  collection because `app.services.ai_stream_turn` did not exist.
- **Green:** Added `StreamTurn.record`, text/output inspection, snapshots, and
  interrupted terminal parts. The accumulator preserves event order, filters
  browser activity and browser retrieval tools, and ignores thought events by
  default. `uv run pytest tests/services/test_ai_stream_turn.py -q` passes.

## Deterministic interrupted persistence

- Added a request-lifecycle regression using the existing PostgreSQL
  `committed_thread` fixture. It saves streamed text and a cancelled tool under
  the deterministic assistant ID even when cancellation is already signaled,
  then verifies duplicate admission returns the saved interrupted parts without
  resuming or appending another message.
- The same targeted run verifies interrupted persistence and the existing
  completed/cancelled row-lock behaviors in `test_persistence.py`.

## Nested transient payload redaction

- **Red:** Added a public `StreamTurn.record` test using an ordinary report
  tool result with nested `browser_context`, `browser_memory`, and image data
  fields. The test failed because the accumulated tool output copied those
  values into transcript parts.
- **Green:** Added recursive redaction for recognized browser payload keys
  and inline `data:image` values. Applied the same sanitizer to completion
  writes, duplicate results, and replay, including legacy/imported parts. An
  interrupted persistence test confirms recognized ephemeral values disappear
  while ordinary artifact `notes` remain. Direct replay also checks raw
  imported parts are sanitized before events are emitted.
- **Refactor:** Grouped completion values into small internal records and
  split transcript validation, sanitization, and append/commit work into
  helpers. Grouped browser API test dependencies behind `BrowserApiHarness`.
