# Streaming prerequisite TDD record

Date: 2 November 2026

## Runner does not retry after streamed supervisor output

Added `test_supervisor_error_after_first_event_is_terminal_without_fallback` to
`backend/tests/services/test_ai_chat_runner.py`. The fake supervisor emits one
answer chunk, then raises. The public runner contract requires one terminal
error, no `done`, and no direct completion attempt.

Red command:

```text
cd backend && uv run pytest tests/services/test_ai_chat_runner.py::test_supervisor_error_after_first_event_is_terminal_without_fallback -q
```

The test failed because the runner logged “Agent supervisor error, falling back
to direct stream”, invoked the direct provider path, and emitted no terminal
error for the supervisor failure. After the change, the runner emits one error,
does not emit `done`, and never invokes direct generation after supervisor
stream entry. The test is green as part of the targeted backend run below.

## Route owns interrupted persistence and error termination

Added `test_runner_error_after_output_saves_interrupted_turn_without_done` to
`backend/tests/api/routes/test_ai_stream_cancellation.py`. Its fake public runner
emits partial text and then an error event.

Red command:

```text
cd backend && uv run pytest tests/api/routes/test_ai_stream_cancellation.py::test_runner_error_after_output_saves_interrupted_turn_without_done -q
```

The regression showed that the route forwarded the error but then persisted the
turn as completed and emitted `done`. The route now stops at the error, saves
visible parts once through its interruption path, and returns without `done`.
The route also uses `StreamTurn` for transcript-safe accumulation and
provider/runner exceptions after visible output. A second route test raises an
exception after the first answer chunk, verifying the exception path saves the
partial turn and does not emit `done`.

## Green run

```text
cd backend && uv run pytest tests/services/test_ai_chat_runner.py tests/api/routes/test_ai_stream_cancellation.py tests/services/test_ai_stream_turn.py tests/api/routes/test_ai_threads.py -q
50 passed, 3 warnings
```

Static checks:

```text
cd backend && uv run ruff check app/services/ai_chat_runner.py app/api/routes/ai_threads.py tests/services/test_ai_chat_runner.py tests/api/routes/test_ai_stream_cancellation.py
All checks passed!
cd backend && uv run ruff format --check app/services/ai_chat_runner.py app/api/routes/ai_threads.py tests/services/test_ai_chat_runner.py tests/api/routes/test_ai_stream_cancellation.py
4 files already formatted
cd backend && uv run mypy app/services/ai_chat_runner.py app/api/routes/ai_threads.py
Success: no issues found in 2 source files
```
