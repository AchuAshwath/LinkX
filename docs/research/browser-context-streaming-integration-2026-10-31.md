# Browser context in ordinary chat streaming

**Date:** 2026-10-31

**Scope:** Follow-up architecture after the narrowed browser-reading demo and its lifecycle fix. This note does not propose changing the current demo before that separate fix is complete.

Tracking: [streaming integration #189](https://github.com/AchuAshwath/LinkX/issues/189), after [capture-close lifecycle #190](https://github.com/AchuAshwath/LinkX/issues/190). Closing capture must preserve a dispatched question's frozen request; explicit chat Stop remains the cancellation control.

## Recommendation

The next issue should first compare two viable designs against the same browser lifecycle harness: a **serial readiness-only gate**, followed by the ordinary stream, and a request-scoped **`read_browser_context` tool** in the ordinary agent loop. Both retain the Send-time frozen context and sequential one-frame reads. The gate asks the selected model only for `read_next`, `ready`, or `insufficient` plus evidence IDs/completeness metadata; it cannot author user-facing text. The tool design lets the ordinary agent request the next accepted frame through a read-only tool. Both are serial and use the same selected model without fallback or parallel inference.

Cost differs from the current evaluator because image transcription is a separate model call. For `N` pending frames, worst case in the current path is `N + 1` evaluator calls plus `N` image-read calls, or `2N + 1` calls. Readiness gate plus final no-tool answer is `N + 1` gate calls, `N` image-read calls, and one answer generation, or `2N + 2`: one additional model call over current at the same fully-read cutoff. Early stop after `k` reads gives `2k + 2` versus current `2k + 1`. A per-frame `read_browser_context` tool in the ordinary loop can use up to `N` model generations to request frames, `N` image-read calls, then one final answer generation: at most `2N + 1` before ordinary tool calls, but the model controls whether it requests enough frames and call count can vary. These totals exclude any compaction call and additional ordinary tool-loop generations. Broad requests requiring all accepted frames consume the whole pending batch.

Treat browser evidence as untrusted reference data, never as instructions. Preserve ordinary product capabilities when the user independently requests them; do not silently disable normal tools just because browser context is attached. Apply existing authorization to tool actions and test that page-derived instructions cannot authorize them. A request-scoped `read_browser_context` tool is a viable alternative for model-controlled retrieval; it gives the agent more control over call frequency and stop timing, as discussed below.

This is a substantial behavior and persistence refactor, not just runner wiring: browser answers currently save before text emission, while ordinary chat emits partial output before its final commit and has fallback/persistence behavior that can repeat or double-own work. Any selected design needs the same single transcript owner and no post-output fallback. This is not a claim that provider-internal reasoning is available. Reuse ordinary chat's user-visible tool events and answer-token stream; browser preparation and reading are application activity, not hidden reasoning. Do not surface raw `reasoning_content` as chain of thought.

## Current evidence in LinkX

- `BrowserModel` uses a provider contract that returns one completed string; `evaluate()` decodes and validates the completed JSON object. The evaluator prompt requests `answer`, `wait`, or `insufficient` plus evidence metadata. See [`model.py`](../../backend/app/observation/model.py#L140) and [`model.py`](../../backend/app/observation/model.py#L369).
- `QuestionRunner.run()` checks the evaluator, reads accepted pending frames sequentially when needed, and reevaluates after each read. It can stop early when evidence suffices, but broad requests require complete coverage. A readiness-only gate preserves this loop without authoring the answer. See [`question.py`](../../backend/app/observation/question.py#L141).
- `BrowserQuestionJob.run()` owns the frozen request context, executes the question runner, and saves the completed answer before the event path emits it. `_result_events()` then emits the whole answer in one `text_delta`. The endpoint has dedicated turn admission/replay behavior and per-thread guarding. See [`ai_browser_chat.py`](../../backend/app/api/routes/ai_browser_chat.py#L124), [`ai_browser_chat.py`](../../backend/app/api/routes/ai_browser_chat.py#L282), and [`ai_browser_chat.py`](../../backend/app/api/routes/ai_browser_chat.py#L449).
- Ordinary `default_chat_stream_runner()` streams agent events, accumulates transcript parts, and persists interrupted turns. The agent catalog includes scraping, curation, and draft tools. Its current supervisor exception path clears accumulated parts and starts a direct completion even if events were already emitted or tools caused side effects. That risks duplicate visible answers and repeated work; it is unsafe to reuse unchanged for browser streaming. See [`ai_chat_runner.py`](../../backend/app/services/ai_chat_runner.py#L279) and [`agent_supervisor.py`](../../backend/app/services/agentic/agent_supervisor.py#L652).
- Ordinary chat emits events before the route commits the completed assistant message. Cancellation currently has interrupted-turn persistence paths in both runner and route. The browser integration needs one transcript owner; it must not layer the browser route's save-before-final-text policy on top of ordinary route/runner persistence. See [`ai_threads.py`](../../backend/app/api/routes/ai_threads.py#L525) and [`ai_chat_runner.py`](../../backend/app/services/ai_chat_runner.py#L316).
- The browser frontend currently selects a dedicated `/browser-chat` request and waits for the context-ready promise before sending. See [`useAIChatStream.ts`](../../frontend/src/hooks/useAIChatStream.ts#L400).
- The implementation contract says browser memory is volatile, chat-owned, cleared on Stop/reload/sign-out/session replacement, and excluded from durable transcript parts. It also says the question freezes the already accepted pending-frame batch, the answer is saved once before emission, replay returns saved completed answers, and an unfinished duplicate must not restart inference. See [`IMPLEMENTATION-CONTRACT.md`](../observation/IMPLEMENTATION-CONTRACT.md#data-flow-and-ownership) and [API and persistence behavior](../observation/IMPLEMENTATION-CONTRACT.md#api-and-persistence-behavior).
- Existing supervisor event parsing can emit a `thought` event from selected provider fields or tagged text. Those fields are implementation-dependent output, not a reliable or complete representation of private model reasoning. See [`ai_chat_runner.py`](../../backend/app/services/ai_chat_runner.py#L122) and the thought parsing helpers nearby.

## Options

| Option | What it means | Assessment |
| --- | --- | --- |
| Readiness-only JSON gate + ordinary stream | Serially ask whether to read one next frame, answer now, or stop insufficient; then invoke one ordinary stream. | Explicit validated sufficiency/read boundary and preserves current early-stop rules. Adds one no-tool answer generation over current at the same read cutoff: worst case `2N + 2`, before compaction/tool turns. Same model, no fallback, no parallel inference. |
| `read_browser_context` tool in the ordinary agent loop | A request-scoped, idempotent, read-only tool returns frozen notes and reads exactly one next accepted frame per call. | For up to `N` unique frame reads and no other tools, it can use `N` frame-request generations + `N` image reads + one final answer = `2N + 1`, matching current worst case; avoids a separate gate but makes sufficiency model-controlled. Repeated tool calls and ordinary tools add generations unless capped. Broad requests need enforced completion. Calls may repeat, be skipped, or interleave with ordinary tools, so progress and correctness vary. Enforce frozen budget and idempotency server-side. |
| Streaming structured evaluator | Stream/parse the existing structured evaluation, which can contain a decision and answer. | Does not meet the normal tool-loop goal. If it authors an answer, ordinary chat afterward duplicates answer generation; if it only gates, it becomes the readiness-only gate. Parsed structured output may arrive only at completion. |

### Trade-offs and guardrails

1. **Prompt trust and side effects.** Browser content is untrusted, while ordinary chat intentionally has capabilities for scraping, drafting, updating, and scheduling. Preserve normal capabilities when current user intent independently authorizes them. Add prompt-injection tests proving page instructions cannot grant authorization or override tool policy.
2. **Call count and answer ownership.** Current worst case is `N + 1` evaluator calls plus `N` image reads = `2N + 1`, before compaction. Gate design adds one final answer generation = `2N + 2`; per-frame browser tool design can stay at `2N + 1` before ordinary tools, but makes sufficiency/call count model-controlled. In both designs, the final ordinary stream owns the only answer. Same selected model throughout, no model fallback or parallel inference.
3. **Frozen input and sequential budget.** Keep the Send-time snapshot immutable for the request. Retain the present accepted-frame cap, five-minute expiry, sequential processing, early-stop rules, broad-question completion behavior, and receipt of completed/failed/unused IDs. A model-requested tool call must not bypass these limits or reopen frames accepted after Send.
4. **Token/context budgeting.** Preserve preflight checks against the selected model, output/schema reserve, context-history pruning, and explicit failure for unknown capacity. The current browser payload has a dedicated 8 MiB request cap and a fixed 32 KiB browser-memory limit; neither proves that browser context plus ordinary chat history and tools fits a selected model. Recompute budget for the actual combined prompt and tool descriptions, reserving answer output. Do not budget just the notes in isolation.
5. **Cancellation and persistence.** Streaming changes save-before-answer emission: answer tokens become visible before the completed turn commits. Begin one request-ID-bound turn; a single route-level owner accumulates the visible parts and commits one completed assistant message before `done`. On cancellation, disconnect, or post-output error, it commits one interrupted assistant turn with visible partial text and ordinary tool-call parts; do not auto-resume that request. Browser frames, notes, gate output, receipts, and progress remain transient. A process crash before final commit can leave only the admitted user turn, so do not claim crash-safe resumption. Remove or bypass runner-level interrupted persistence for this route. Local Stop cannot guarantee remote provider cancellation.
6. **Duplicate tools and fallback.** Make browser evidence reads idempotent and enforce the frozen frame budget. Side-effecting tools retain ordinary authorization and need duplicate-execution handling. Once a supervisor event or tool side effect occurs, propagate a terminal error; do not clear emitted parts and start a direct completion. Any fallback must occur before visible output and side effects and must use the same selected model.
7. **Reasoning visibility.** The public LangGraph stream model distinguishes message chunks, state updates, and custom progress. This supports forwarding answer chunks and browser status as separate event classes; it does not establish access to hidden model reasoning. Keep UI progress factual (for example, “Reading shared view 1 of 2”), and follow existing product policy for any `thought` fields.

## Framework and protocol evidence

- LangGraph documents separate stream projections: `messages` for model message/token chunks, `updates` for graph state changes, and `custom` for application-emitted progress. It also notes model/provider integration constraints. This supports distinct answer and browser-activity events, not a claim that status is model reasoning. [LangGraph streaming](https://docs.langchain.com/oss/python/langgraph/streaming).
- LangChain describes agents as model/tool loops shaped by prompts, tools, and middleware. This makes tool availability a security/product boundary, not just a UI choice. [LangChain agents](https://docs.langchain.com/oss/python/langchain/agents).
- The LangChain Amazon Nova integration documents structured-output streaming where the parsed object appears after the complete response. This is a provider-specific example; it shows why structured streaming should not be assumed to provide incremental final prose for every model. [Amazon Nova structured-output streaming](https://docs.langchain.com/oss/python/integrations/chat/amazon_nova).
- LangGraph's design guide recommends storing raw state and formatting prompts on demand, and explains checkpointed state/interrupt behavior. Those facilities can support a future durable graph, but LinkX's current browser memory is explicitly volatile and process-local; adopting graph checkpoints would change the privacy, persistence, and resume contract and is not needed for this demo increment. [Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph).
- MCP documentation provides an analogy for request-scoped cancellation and progress: cancellation is cooperative, and progress requires a request progress token. LinkX's current transport is HTTP SSE and does not use MCP, so its cancellation and event guarantees must be specified and tested in LinkX rather than imported from MCP semantics. [MCP TypeScript SDK progress/cancellation](https://ts.sdk.modelcontextprotocol.io/v2/servers/logging-progress-cancellation), [MCP Tasks cancellation](https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks).

## Suggested phases and acceptance criteria

### Phase 0: retain the current demo while resolving lifecycle bug

- Merge the narrowed demo only after its separate lifecycle bugfix is complete.
- Keep this integration work out of that merge; this proposal is a follow-up issue.

### Phase 1: compare both designs before selecting implementation

Build comparable traces/acceptance results for both designs using the same selected model, frozen input, accepted-frame batch, model/provider configuration, and final answer/tool policy. Do not implement either in the product as part of this spike.

| Acceptance dimension | Readiness gate | `read_browser_context` tool |
| --- | --- | --- |
| Read/cutoff behavior | At most `N + 1` serial gate calls and `N` image reads; explicit `read_next` / `ready` / `insufficient`; current broad-query policy requires the full batch. | At most `N` unique one-frame reads; enforce full-batch behavior for broad queries despite model choice; cap duplicate/empty calls. |
| Model-call accounting, no extra ordinary tools | Worst case `2N + 2` including one final answer generation; early-stop after `k` reads is `2k + 2`. | `2N + 1` for `N` unique frame tool requests, `N` image reads, and one answer generation; repeats/ordinary tools can add calls unless capped. |
| Stream UX | Gate/read progress is transient; ordinary answer tokens and permitted tool events stream only after readiness. | Browser reads appear as ordinary tool events interleaved with assistant generations; progress can vary with model-selected calls. |
| Trust and authorization | Evidence is untrusted; prompt-injection cases cannot invoke tools without normal user authorization. | Same, plus injection cases cannot cause repeated browser reads, exhaust work outside frozen batch, or override ordinary tool policy. |
| Budget and failures | Preflight every gate/final prompt with schema/tools/output reserve; explicit overflow/unknown capacity; same model, no retry/fallback, no parallel inference. | Same requirements for every agent/tool turn; explicit frame and agent-loop limits; same model, no retry/fallback, no parallel inference. |
| Persistence/lifecycle | One request owner commits completed streamed parts before `done`, or one interrupted partial on cancel/disconnect/post-output error; replay never repeats reads. | Same. Browser tool outputs/progress stay ephemeral while ordinary tool parts follow ordinary transcript rules. |
| Runner failure behavior | No direct-generation fallback after any gate/read/agent output or side effect. | No direct-generation fallback after any agent/tool output or side effect. |

The counts above are arithmetic derived from LinkX's current evaluator/read loop and the proposed call shapes, not framework performance guarantees. Choose based on measured model-call count/latency, correctness on early-stop and broad cases, legible progress, and implementation/persistence complexity. The gate makes the read/answer boundary explicit but still relies on the model's validated sufficiency decision, and costs one more no-tool generation than current at equivalent full read. Tool integration can match current worst-case retrieval-plus-answer calls but moves sufficiency decisions into the agent loop and requires stricter tool-call caps.

### Phase 2: implement the selected design after prerequisite refactors

- A Send operation captures one immutable chat-owned browser snapshot and does not include frames accepted afterward.
- Keep bounded sequential reads, broad-question completion, failures, and completed/failed/unused receipts.
- Browser evidence is clearly delimited as untrusted; prompt-injection tests verify page text cannot grant permissions. Preserve ordinary tools when independently authorized by current user intent.
- The ordinary stream starts once after preparation/tool retrieval and owns the only answer. Answer tokens and ordinary tool events stream alongside distinct transient browser activity.
- Re-budget the actual combined prompt, conversation history, tool definitions, structured gate overhead when applicable, and answer reserve before every model call. Keep errors explicit; do not drop protected evidence or switch models.
- Because answer text streams before completion, establish one route-level transcript owner: commit one completed assistant turn before `done`, or one interrupted partial on cancellation/disconnect. Browser frames, notes, gate output, receipts, and progress remain transient. Remove/bypass runner-level duplicate persistence.
- Completed replay does not repeat reads or tools. An unfinished duplicate never auto-restarts inference. Preserve ownership/thread guards and Stop's local stale-result guarantees.
- Any error after output or a side effect terminates the stream; no second direct-generation run. The existing ordinary-runner fallback path must be changed or bypassed.

#### Additional criteria if the tool design is selected

- Tool reads are request-scoped, read-only, idempotent, and limited to the frozen context and remaining accepted-frame budget.
- Repeated calls do not repeat completed frame reads or create duplicate transcript entries; results retain source IDs and uncertainty.
- Add the browser evidence tool without silently removing ordinary chat capabilities. Existing side-effect tools remain governed by the user's current request and existing authorization policy; page content cannot authorize them.
- Tool start/output/failure events map to the existing stream and persistence contract without storing full browser memory in chat history.

## Issue-ready summary

**Title:** `chore(ai): compare browser context streaming designs`

**Description:** After the current browser demo lifecycle fix merges, compare a readiness-only gate with a request-scoped `read_browser_context` tool. Report call counts including image reads (current full-batch worst case `2N + 1`; gate plus ordinary no-tool answer `2N + 2`; per-frame tool retrieval plus answer `2N + 1` before duplicate/ordinary tool calls), along with early-stop/broad-query correctness, stream UX, prompt-injection behavior, budgeting, and persistence complexity. Use the same selected model and frozen batch, with serial inference, no retry/model switch/fallback, and no product implementation in the spike. Identify the required persistence-owner and no-post-output-fallback refactors before filing the implementation issue. Preserve ordinary tool policy and browser-memory volatility.

**Open decisions:**

1. Use the acceptance matrix to select the gate or tool design after the spike; neither is selected as the implementation default yet.
2. Which existing `thought` event behavior is product-approved? Do not use hidden/internal reasoning as an acceptance criterion.
3. Keep the dedicated browser endpoint/request cap or let the ordinary endpoint accept an equivalent bounded snapshot? Either way, use one transcript/persistence owner and retain replay semantics.
