# Issue #189 final independent audit

Date: 6 November 2026
Baseline: `8d0dd293519d2b9cefaaf5006262169dff7c7d00`
Scope: staged and working-tree changes for browser-answer streaming, associated
frontend event handling, regressions, and implementation evidence. Read-only
review; no tests, live calls, or production edits were made for this audit.

## Result

No concrete remaining blockers were found in the reviewed #189 scope. The
previously reported action-authorization, insufficient-readiness drain, private
thought recovery, nested tool event duplication, parallel tool identity,
tool-error state, privacy redaction, persistence ownership, post-output fallback,
and per-invocation budget issues have corresponding implementation and
regression coverage in the current diff.

This is a code and evidence audit, not a claim that readiness or browser reading
is universally accurate. Authorization remains a conservative supported direct
request grammar. Evidence IDs and readiness decisions are structural checks,
not proof of factual grounding.

## Reviewed sources and checks

| Area | Audit check | Evidence |
| --- | --- | --- |
| Scope and repository rules | Read `AGENTS.md`; resolved baseline commit; inspected staged and working-tree diffs and status | The feature changes are staged against `8d0dd29`; no unstaged production changes were present. `git diff --check 8d0dd29` passed. |
| Contract and plan | Read `IMPLEMENTATION-CONTRACT.md`, `STREAMING-REVIEW.md`, the issue #189 plan, and review notes | The plan file present in the repository is `issue-189-streaming-plan-2026-11-02.md`; it describes the readiness gate, ordinary selected-model agent, request-bound persistence, and stated limits. |
| Readiness and authorization | Inspected `question.py`, `model.py`, `browser_agent.py`, and their public-seam regressions | `test_readiness.py` covers `insufficient` without reading unrelated pending frames, broad settlement, failed-frame gaps, and evidence validation. `test_browser_agent.py` covers educational, hypothetical, capability, advice, quote, and direct-action examples. The code documents and enforces only its anchored supported grammar; no general NLP guarantee is inferred. |
| Agent stream and private content | Inspected event normalization, `ToolEventFilter`, `StreamTurn`, persistence sanitization, and privacy tests | Coverage includes nested same-name wrapper deduplication while retaining sibling calls, private thought suppression in browser mode, recognized nested browser payload removal, inline image-data redaction, and sanitization during replay. |
| Tool errors and identity | Inspected runner, accumulator, frontend handlers, and regressions | `on_tool_error` emits a fixed safe failure result; accumulated/replayed and frontend tool parts become failed. Frontend events carry IDs, and same-name parallel results are matched by ID. `test_browser_tools_streaming.py`, `test_streamed_tool_identity.py`, and frontend stream tests cover these paths. |
| Persistence, replay, fallback | Inspected browser route, shared runner, persistence, and route/service regressions | The browser job owns its completion and interrupted-part save. Completed replay emits saved ordinary parts without generation; interrupted duplicates return conflict. Post-output runner failures terminate without direct-generation fallback. `test_browser_streaming.py`, `test_persistence.py`, and cancellation/runner tests cover the lifecycle. |
| Budgets and provider behavior | Inspected `ai_agent_budget.py`, `BrowserAgentPolicy`, provider setup, and focused tests | Actual prompt, continuation, and tool definitions are budgeted at each agent invocation; unknown/overflow cases fail closed. Browser provider clients use bounded timeout and no SDK retries; no model substitution or answer fallback is configured for browser read, readiness, or final-answer generation. |
| Public API / generated client | Compared OpenAPI and frontend client paths against baseline | No OpenAPI or generated-client diff was present; the changed readiness schema is internal. The parent regenerated the SDK successfully with no generated diff. |
| Validation evidence | Read the recorded TDD, system-smoke, pending-close, endpoint, and review artifacts | Reported final validation: backend 1009 passed; frontend 385 passed; Ruff and mypy clean; CodeScene local safeguard passed for 40 eligible files; the parent subsequently reports the post-commit branch delta also passed for 40 eligible files. Controlled Chrome run: 25 system checks plus 3 pending-close/Stop scenarios passed. Selected live endpoint smoke: 90 answer chunks using synthetic notes. These are recorded evidence, not reruns by this read-only audit. |

## Evidence limits

- The selected live endpoint result uses synthetic browser notes and supports
  incremental delivery only; it is not screenshot-grounding or OCR accuracy
  evidence. The retrieval comparison also reports synthetic-text trials and
  does not establish a latency or quality winner.
- Controlled Chrome tests exercise the real capture/session/UI/HTTP/database
  path with scripted provider responses and synthetic views. They do not certify
  physical sharing-dialog behavior, arbitrary pages, or live-model accuracy.
- Tokenizer and model-capacity metadata remain estimates/dependencies of the
  selected model configuration. Evidence IDs and readiness output do not verify
  every answer claim.
- Tool authorization supports a small direct-action grammar and intentionally
  denies ambiguous or unsupported phrasing. Do not read it as a universal
  natural-language intent classifier.
- The feature remains single-process; remote calls cannot always be recalled,
  executed external actions are not rolled back, and a crash before persistence
  can lose output. This is not distributed coordination, crash-safe recovery,
  or exactly-once side-effect execution.

## Scope qualification and disposition

A follow-up read-only scope check found that the retained ordinary draft tool
uses the global draft model and template fallback, and ordinary tool calls may
execute concurrently. Those are inherited ordinary-tool behaviors. The selected
model, no fallback, and serial browser-read guarantees cover evidence preparation
and final-answer generation, not every nested ordinary-tool pipeline. The final
contract and review document this boundary explicitly.

No further code changes are requested by this audit. Consolidated validation and
publication status are maintained in [STREAMING-REVIEW.md](STREAMING-REVIEW.md).
