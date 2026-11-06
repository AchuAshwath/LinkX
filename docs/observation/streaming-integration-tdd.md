# Streaming integration TDD record

2 November 2026. Public seams agreed in the implementation plan: selected-model
runner events, authenticated browser-chat HTTP/SSE and transcript retrieval,
request-bound persistence, and browser UI event delivery.

| Slice | Observed red | Green behavior |
| --- | --- | --- |
| Combined agent budget | New public budget module was absent | Actual tool definitions counted with protected prompt; oversized tool input is rejected |
| Real answer chunks | Browser endpoint emitted one complete `The code is SAPPHIRE-742.` delta | Real ChatOpenAI transport chunks arrive separately through the normal agent |
| Structured replay | Saved tool part produced no `tool_start` or `tool_output` on completed replay | Saved ordinary tool events replay without another model/tool invocation |
| Browser answer timeout | Browser OpenAI client timeout was `None` | Sync and async browser SDK clients use 45 seconds and zero retries; ordinary clients unchanged |
| Failure partials | Ordinary provider errors added `Generation stopped by user` to saved text | Provider failures preserve the partial as interrupted without falsely attributing Stop to the user |

Commands used for these cycles:

```bash
cd backend
uv run --no-sync pytest tests/services/test_ai_agent_budget.py -q
uv run --no-sync pytest tests/observation/test_browser_streaming.py -q
uv run --no-sync pytest tests/services/agentic/test_browser_agent.py -q -k disable_sdk
uv run --no-sync pytest tests/api/routes/test_ai_stream_cancellation.py -q -k 'runner_error_after_output or runner_exception_after_output'
```

The streaming route tests use the actual normal agent, tool inventory, provider
schema validation and database persistence. Only external model HTTP responses
are scripted. The partial-error test verifies one interrupted assistant, one
safe error, no `done`, no provider retry or replacement generation, and a 409 on
attempted replay of the interrupted request.

Other focused cycles and review-driven regressions are recorded in
`streaming-readiness-tdd.md`, `streaming-persistence-tdd.md`,
`streaming-prerequisite-tdd.md`, `streaming-tool-identity-tdd.md`, and
`streaming-review-fixes.md`. CodeScene refactors were run after the behavior
tests were green; functions were split without loosening assertions.

The final validation summary belongs in `STREAMING-REVIEW.md`. This log records
observed red/green behavior rather than a claim that every added test began red.
