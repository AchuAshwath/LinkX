# Issue #189 retrieval comparison v1

Date: 2 November 2026
Scope: isolated comparison spike; no production files changed.

## Runnable commands

From the repository root:

```bash
python3 backend/scripts/observation_lab/streaming_comparison_v1.py
```

The deterministic harness writes `deterministic-results.json`. A deliberately
capped optional live run uses the configured ordinary chat model and only the
synthetic records embedded in the script:

```bash
cd backend && uv run python scripts/observation_lab/streaming_comparison_v1.py --live --max-live-cases 2
```

The live cap is hard-limited to two cases (early answer and broad list), and
each case runs both candidates serially. The live artifact is
`live-results.json`. API keys are loaded from app settings, never printed or
written to the artifact. No browser, screenshot, user page, database, or
application server is used.

## Harness shape

Both candidates consume the same frozen synthetic memory, pending records,
question, broad-query classifier, answer policy, and serial call lane.
Deterministic mode uses a scripted provider and controlled delays. It covers
ready memory, a supported early answer, a full-list request, a general question,
a failed/missing frame, and hostile page text. It reports first activity, first
answer token, completion, logical calls, reads, and byte-based token estimates.
Those timings measure the harness and those token values are rough estimates;
neither is provider performance or a real tokenizer count.

The gate returns only `read_next`, `ready`, or `insufficient`; a separate answer
call owns user-facing text. The tool prototype models a request-scoped,
read-only `read_browser_context` operation that advances one frozen frame at a
time. The server-side policy caps unique frames and repeated/empty calls, and
forces every accepted frame to be read before a broad answer can proceed. Both
paths disable retry, fallback, and parallel calls. The hostile fixture has no
ordinary side-effect tool configured; the fixture verifies answer behavior, not
the product's full authorization boundary.

Live mode uses the same `settings.AI_MODEL` for readiness/action generation,
synthetic record transcription, and the final answer. Records are text, not
images. The text transcription call is only a cost/call-shape proxy for a
future image reader and does not measure screenshot interpretation. The final
answer is streamed so first answer token timing is measured; other calls are
serial non-streaming calls. Provider-reported usage is aggregated across all
calls. No retries or model switches occur. Each failed call is retained as a
trace status rather than triggering fallback.

## Live trace summary

Selected model: `gpt-5.6-luna`. Each row is a single synthetic trial.

| Case | Candidate | Calls | Frames | Provider tokens in/out | First activity | First answer token | Completion | Expected terms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Early answer | Readiness gate | 4 | 1 | 1,419 / 164 | 0.01 ms | 9.19 s | 9.52 s | yes |
| Early answer | Evidence tool | 4 | 1 | 1,493 / 138 | 0.04 ms | 25.61 s | 25.73 s | yes |
| Broad full list | Readiness gate | 6 | 2 | 2,166 / 449 | 0.01 ms | 19.15 s | 19.54 s | yes |
| Broad full list | Evidence tool | 6 | 2 | 2,277 / 285 | 0.04 ms | 15.95 s | 16.47 s | yes |

Both broad trials read both frozen records before answering. Both early trials
read one record. The first activity values reflect when each request starts;
they are effectively immediate. The substantial per-call latency variation
across the paired early trials means these four trials do not support a latency
winner. The gate's readiness output is structurally restricted to status JSON;
the tool path has a natural ordinary-agent action boundary, but requires the
server completeness and call caps shown here.

The deterministic result has 12 traces across the six requested cases. Both
candidates perform zero frame reads for ready memory and general questions, one
successful read for early and hostile cases, and two for broad requests. The
missing-evidence case records one failed frame attempt and remains insufficient.
The hostile case answers the supported status and makes no side-effect call in
the harness. See
`deterministic-results.json` for timings, calls, and input/output estimates.

## Recommendation and limits

This spike does **not** establish that either approach is ready for production,
nor does it establish answer quality beyond the small synthetic checks. It also
does not evaluate screenshot reading, real broad-request detection, real tool
authorization, persistence ownership, cancellation, transcript replay, context
budgets, or frontend event handling.

Keep both candidates open. The tool candidate's potential one-call advantage
over the readiness gate is not demonstrated here: both live cases used equal
call counts because the gate decision/read schedule and tool action/read
schedule were the same. The tool remains more dependent on a strict request
scope, completeness guard, repeat/empty-call limits, and ordinary tool
authorization. The gate makes sufficiency and the boundary before final prose
explicit, while adding a dedicated generation step in cases where that is
needed. Use a larger predeclared synthetic/adversarial matrix plus repeated live
trials before choosing; then compare actual image-reader calls and normal tool
loops with the same prompts, frozen screenshots/notes, and output policy.

The next integration work still requires the issue-plan prerequisites: one
transcript persistence owner and terminal failure after output or possible tool
execution. This spike intentionally changes neither.
