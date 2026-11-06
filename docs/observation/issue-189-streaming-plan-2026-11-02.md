# Issue #189: browser-assisted answers through ordinary chat streaming

Date: 2 November 2026
Status: implemented, validated, and approved for commit and draft PR publication on 6 November 2026.
Final decision, evidence, and limitations: [streaming review](STREAMING-REVIEW.md).
Baseline: merged master `8d0dd29` (PRs #182–#188).
Issue: https://github.com/AchuAshwath/LinkX/issues/189

## Outcome

Browser-assisted questions should use the same incremental answer and authorized
tool flow as ordinary chat. Browser reading remains temporary activity. Each
request produces one answer, with one owner responsible for saving its visible
parts, cancellation, and replay.

At this plan's baseline, the browser path was SSE already, but its evaluator returned a completed
JSON answer and `ai_browser_chat.py` emits that answer in one `text_delta`.
Splitting that completed string into artificial chunks would not meet this goal.

## Manual baseline acceptance

The user reported the merged #190 correction fixed before implementation. The
controlled [pending-image regression](pending-capture-close/README.md) now also
covers the difficult two-image timing. The original manual baseline was:

1. Share a tab, submit a question, then close the source or floating preview.
   Capture stops and temporary session memory clears; the dispatched answer finishes.
2. Start another share while the earlier question finishes. The new share opens;
   its frames wait for the earlier model work and never inherit old notes.
3. Press chat Stop on an active answer. This explicitly cancels that request.

An undispatched prepared question can still be invalidated when sharing ends.
Source closure and explicit chat cancellation have deliberately different behavior.
If the user finds a defect, repair that regression before integrating #189.

## Existing seams and prerequisites

| Module | Present behavior | Planned responsibility |
| --- | --- | --- |
| `backend/app/observation/question.py` | Evaluates and authors the final answer; sequential image reads | Frozen evidence preparation or request-scoped retrieval; final prose belongs to the ordinary runner |
| `backend/app/api/routes/ai_browser_chat.py` | Admission, job, receipt, save-before-answer emission | Keep bounded browser ingress, broker ownership and replay; delegate generation to shared runner logic |
| `backend/app/services/ai_chat_runner.py` | Agent event stream; direct fallback after any supervisor exception; interrupted persistence | Shared generation without transcript writes; terminal failure after output or possible tool execution |
| `backend/app/api/routes/ai_threads.py` | Collects streamed parts and also saves interrupted output | Reuse one turn lifecycle module across ordinary/browser routes |
| `backend/app/observation/persistence.py` | Deterministic request/message IDs; completed text replay | Extend the request-owned completion interface to supported ordinary parts and interrupted status |
| `frontend/src/hooks/useAIChatStream.ts` | Browser endpoint selection plus shared event handlers | Consume real answer chunks/tool events while preserving transient browser events and receipts |

The first prerequisite is single ownership of persistence. Both the ordinary
runner and route currently save interrupted turns. The second is fallback safety:
the runner currently clears accumulated parts and starts direct completion after
a supervisor exception, even after events or tool effects. Do not reuse that
behavior in browser streaming. An ambiguous tool failure must count as possible
execution, even if no successful tool output reached the client.

## Step 1: compare retrieval designs

Keep this spike isolated from the running acceptance app. Use the same selected
model, frozen notes, accepted frames, prompts, tool policy, deadlines and cases.
Do not select a design from theoretical call counts alone.

| Candidate | Shape | Main tradeoff |
| --- | --- | --- |
| Readiness gate | Serial `read_next / ready / insufficient`, then one ordinary streamed answer | Explicit evidence settlement, but adds an answer-generation call after the gates |
| Browser evidence tool | Ordinary agent can request the next accepted view through `read_browser_context` | Integrates retrieval into the normal loop, but needs server enforcement of completeness and bounded repeated calls |

For N pending frames fully read, a no-extra-tool gate run uses N reads + N+1 gates
+ one answer call = 2N+2 calls. A tool run with exactly one model request per
unique frame uses N request generations + N reads + one answer = 2N+1 calls.
Tool retries/repeats and ordinary tools can add calls; compaction is separate.
These are proposed call shapes, not measured latency or quality guarantees.

Record first activity, first answer token, total time, calls/tokens, evidence
correctness, broad-request settlement, and cancellation/error traces. Cover ready
memory, one/two pending frames, supported early answers, earlier-view recall,
full-list questions, general questions, missing/failed evidence, and hostile page
instructions. Prototype both before writing the design decision and choosing.

## Step 2: establish the shared turn lifecycle

Create a deep turn lifecycle module with a small interface: admit a request,
consume ordinary stream events, finish it completed or interrupted, and replay
its saved result. Keep database writes short and row-locked; do not hold a
database transaction across provider inference. Route adapters own transport;
the shared generation runner emits events without writing the transcript.

Use deterministic request/message IDs. Save one user turn and at most one
assistant turn. Save ordinary visible partial text/tool parts once on cancellation,
disconnect, or error after output; completed output commits before `done`.
Completed replay returns saved parts without repeating inference or tools.
Interrupted or unfinished duplicate requests never automatically rerun work.
Do not claim crash-safe recovery or exactly-once remote side effects.

Add regressions through the public route/runner interfaces before changing
ownership. Cover errors before output, after a text chunk, after tool start,
after tool completion, during transcript save, and cancellation during cleanup.
Disable automatic fallback after inference starts for the browser path; ordinary
fallback can remain only where no output or possible tool execution has occurred.

## Step 3: integrate the selected retrieval design

Keep the dedicated bounded browser endpoint initially. Share runner logic
internally instead of merging request schemas and endpoints at the same time.

- Freeze the Send-time chat/session/model/evidence snapshot and accepted batch.
  Preserve sequential reads, expiry, deadlines, completed/failed/unused receipts,
  model work serialization, and the existing memory/frame limits.
- Enforce broad browser completion on the server before final prose can claim
  completeness. General/conversation answers should avoid irrelevant frame drains.
- Budget the actual agent prompt, protected history/question, browser evidence,
  tool definitions, schema overhead where applicable, and output reserve on every
  invocation. Unknown capacity and overflow are explicit failures.
- Keep selected-model behavior consistent for browser read, readiness, and final
  answer calls. No silent model switch or retry in those calls. Retained ordinary
  tools keep their existing internal models, fallback, and concurrency behavior;
  see the [implementation contract](IMPLEMENTATION-CONTRACT.md).
- Browser text is untrusted reference data. Ordinary tools remain available under
  existing user authorization; page instructions cannot authorize draft edits,
  scheduling, navigation, or other actions.
- Keep browser notes/images/tool retrieval payloads out of durable transcript
  parts, including nested tool outputs and replay. Persist only ordinary allowed
  answer/tool parts; transient evidence must not leak through a generic accumulator.
- Preserve #190 ownership: capture closure clears the capture session while the
  dispatched request retains its snapshot. New sharing waits for old model work.
  Chat Stop cancels the request; late results cannot alter replacement memory.

For the tool candidate, cap reads and repeated/empty tool calls. Make invocation
replay idempotent while allowing distinct authorized calls to advance one frame
at a time. Browser evidence retrieval stays read-only and request-scoped.

## Step 4: frontend and acceptance

Reuse ordinary `text_delta`, tool start/output, and terminal handling. Browser
read/prepare activity and receipts remain separate temporary events. Forward only
explicitly supported provider-visible reasoning summaries, if available; raw
internal reasoning fields are not a required output or a substitute for progress.

Test normal chat and browser chat together: partial text, tools, explicit Stop,
disconnect, source/preview close, replacement sharing, replay, newer composer
drafts, errors after output, tight budgets, prompt injection, and saved history
without browser-memory payloads. The live selected-model smoke must observe
multiple answer chunks arriving before completion; a scripted provider only proves
transport and lifecycle behavior.

Run host Ruff/format, mypy, frontend lint/build/typecheck, relevant tests followed
by the full backend/frontend suites, SDK regeneration if public schemas change,
and CodeScene delta before publication. Preserve desktop Chrome acceptance and
record supported-model/browser limits. Update the existing implementation contract
to replace save-before-text with the new partial-output ownership rules.

## Delivery order

1. User baseline test and a separate comparison spike with a recorded decision.
2. Persistence ownership and fallback safety, verified on ordinary chat.
3. Selected browser retrieval integrated with the shared runner and budgets.
4. Frontend compatibility, live incremental-delivery evidence, full checks and
   updated contract. Commit/PR publication remains a separate user-authorized step.

## Source context

The existing [31 October investigation](../research/browser-context-streaming-integration-2026-10-31.md)
contains the initial tradeoffs and code references. Current primary documentation
confirms separate message, state-update and custom-progress streams in
[LangGraph streaming](https://docs.langchain.com/oss/python/langgraph/streaming)
and model/tool loops in [LangChain agents](https://docs.langchain.com/oss/python/langchain/agents).
Those docs describe current framework capabilities; implementation must match the
repository's locked dependency versions. A framework upgrade is outside this plan.
