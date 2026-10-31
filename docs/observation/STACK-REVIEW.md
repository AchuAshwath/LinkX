# Browser reading review stack

The current demo was accepted in a manual smoke review on 25 October 2026. This stack separates the implementation and follow-up fixes for review. Each PR targets the preceding branch; review in this order. Nothing has been merged.

| Layer | Review | Scope and issues |
| --- | --- | --- |
| 1 | [PR182](https://github.com/AchuAshwath/LinkX/pull/182) | Bounded reading API, strict model output, budgets; #168, #175, #181 |
| 2 | [PR183](https://github.com/AchuAshwath/LinkX/pull/183) | Incremental question API, complete list requests, ordinary-turn persistence, awareness and naming; #161, #176, #180 |
| 3 | [PR184](https://github.com/AchuAshwath/LinkX/pull/184) | Pure temporary memory and activity types; #171 |
| 4 | [PR185](https://github.com/AchuAshwath/LinkX/pull/185) | Chat-owned capture/session, startup termination, stopped image activity and terminal errors; #159, #161, #176, #177 |
| 5 | [PR186](https://github.com/AchuAshwath/LinkX/pull/186) | Late voice results, revision-fenced queue cancellation and newer-draft preservation; #178 |
| 6 | [PR187](https://github.com/AchuAshwath/LinkX/pull/187) | Transcript following, reading position and sharing menu; #179 |
| 7 | This branch: `codex/browser-audit-review` | Contract, developer debugging, validation and generated route metadata; #172, #173 |

Parent issue: #150. The combined feature is in `codex/browser-audit-review`; parent-relative diffs keep individual reviews smaller. Merge/retarget the stack only after explicit approval.

## Delivered behavior

- Shared-tab video capture admits meaningful readable changes through the existing v3 sampler; encoder checkpoints include already-selected views in a question's bounded batch.
- A layout-owned session survives chat navigation, keeps browser context with one owning chat, and rejects stale generation/model results. Stop, reload and sign-out clear temporary memory.
- Selected-model background reading produces bounded, content-first notes through strict response contracts. A sequential question loop can read another accepted image and reevaluate without inventing missing evidence.
- Browser memory is bounded to32KiB with versioned prefix compaction. Actual request fitting separately accounts for the selected model, conversation, question, schema overhead and output reserve. Adaptive50% allocation is not implemented or claimed optimal.
- Questions and final answers use ordinary chat persistence with ownership/concurrency/replay guards; images, notes, summaries and browser activity remain outside persisted answer parts.
- Image activity shows actual bounded excerpts and one running status. Send admission is immediate, new drafts survive delayed acknowledgement, first-turn naming is best effort, and explicit SSE errors terminate once.
- Fine upward navigation preserves reading position, forward return/jump resumes following, and sharing controls remain compact and keyboard accessible.

## Validation

Checkpoints are separate, not additive. See [validation-summary.json](validation-summary.json).

| Checkpoint | Result |
| --- | --- |
| Reading API standalone | 868 backend tests, 266 frontend tests, host SDK generation, Ruff, mypy, frontend lint/build, CodeScene and normal hooks passed |
| Question API | 934 backend tests, Ruff/format, mypy, SDK generation, frontend lint/build and CodeScene passed |
| Memory layer on its actual parent | 286 frontend tests;20 focused memory/activity cases; build and staged CodeScene passed |
| Frontend activation | 360 frontend tests and7 v3 stream tests, lint/build and staged CodeScene passed |
| Voice and scroll layers | 363 frontend tests, desktop Chrome regression1/1, lint/build, CodeScene and normal hooks passed |
| Final combined worktree | Fresh20-check controlled full-app smoke and Chrome regression1/1 passed |

The final system test uses real capture/session/HTTP/Postgres behavior and a scripted external provider. Separate live studies use synthetic screenshots. Safe metadata for the reader studies is retained in [reader shape probes](reader-shape-probe-result.json), [strict reading pipeline](strict-reading-pipeline-result.json) and [final string constraints](strict-reading-final-schema-result.json). The initial reader shape probe did not reproduce the original private invalid response; exact syntax is unknown. These samples do not guarantee transcription accuracy on arbitrary pages.

The Chrome fine-scroll case translates a real wheel event into deterministic sub-8px default movement because Playwright/Chrome rounds that input at the bottom; it is not physical-trackpad or cross-engine certification. [System results](system-smoke-result.json) and the [sharing-menu record](chat-scroll-menu.json) retain their narrower test scopes.

## Issue disposition and retained research

Implementation for the accepted scope is ready for review across #159/#168/#171/#161 and fixes #175–#181. #172 remains the formal review/merge gate; #173 records the narrowed accepted contract. Historical prototype tickets #166/#169/#170 are updated to distinguish accepted decisions from unmeasured aspirations. Raw planning/probe archives remain local, rather than publishing broken links, machine-specific paths or raw page/model output.

The generator fix in PR182 makes host and Docker-fallback SDK output stable across normal commit hooks. This final layer also synchronizes type-only route metadata with the versions already pinned in the lockfile; no runtime route is added or removed. No provider retention/location, legal/ToS determination, participant accessibility outcome, multi-worker coordination or exhaustive-page accuracy is established by these checks.

## Hosted gate follow-up

Hosted CodeScene required a10.0 score for new files and flagged the initial mixed model-test module, although local delta checks passed. Its tests were split into cohesive budget, evaluation, compaction and provider modules. All15 original test-function names and80 assertion ASTs were preserved; all four new modules score10.0, and the standalone reading-API suite still passes868 tests. This changes test organization only. The adjustment is carried forward through the review branches without rewriting published history. Hosted status should be checked at each PR's current head.

## Post-review fixes and publication

The final review found four regressions, now addressed in their owning layers. PR183 settles accepted pending views for “full list” and “complete list” requests even if the evaluator marks the question narrow. PR185 installs source-end monitoring before playback and generation-fences startup and reentrant callbacks; it also preserves and renders stopped image activity before answer text arrives. PR186 uses revision-fenced queue recovery, including intentionally cleared drafts, delayed no-op form clears and multiple ordinary queued prompts. Queue handling is extracted into a focused hook to retain the repository's CodeScene limits.

Each regression was reproduced before its repair. Permanent tests exercise the public question runner, capture adapter, real feed/form/queue boundary and actual message renderer. The refreshed validation summary records 936 backend tests, 377 frontend tests across 43 files, 55 v3 capture tests, 20 controlled system checks and ten repeated Chrome scroll cases. These counts are separate checkpoints. The system smoke scripts the external model while retaining real capture/session, HTTP, authentication and Postgres behavior; it does not establish live-provider accuracy.

The fixes are carried forward with normal merge commits through the review stack. Standalone validation is repeated for changed frontend layers; backend app/test fingerprints must match the fully tested question API layer before sharing its 936-test result. The final source files are compared with the reviewed candidate, and normal commit hooks remain enabled. Hosted checks must pass at the resulting PR heads before merge. The specific random-page acceptance scenarios remain tracked in #172; they are not inferred from automated checks.


A final repeat exposed a browser-test sampling race: Shift+Space continued native scrolling after the threshold was reached, so the test sometimes captured its anchor before the viewport settled. The test now waits for ten consecutive animation frames with a stable `scrollTop` before recording the anchor. The original product assertions and tolerances remain unchanged; 10/10 Chrome repeats passed. This is a test-only stabilization, not a product scroll behavior change.

## Manual acceptance follow-up — 2026-10-31

Manual testing exposed a capture/turn lifetime bug tracked in [#190](https://github.com/AchuAshwath/LinkX/issues/190): closing a shared source or preview cancelled a dispatched question and could leave a permanent local processing blocker. The correction keeps only submitted-operation lifecycle metadata across capture teardown, clears retained browser memory immediately, and lets the frozen question finish. Replacement capture opens while its frames wait for the existing request. Late notes cannot populate replacement memory. Definite rejected requests and stale successful read/compaction completions release their operation IDs; inconclusive settlement is rechecked with bounded backoff.

The public session and stream-delivery regressions reproduce cancellation, restart, and rejection ordering before their repairs. The updated controlled full-app test passed 24 checks, including both source and preview closure during an answer followed by immediate sharing replacement and successful completion without a question-cancellation request. The refreshed frontend suite passed 382 tests across 43 files. These system checks use synthetic pages and a delayed scripted provider; they do not measure live transcription accuracy.

The current demo's final browser answer remains a single non-streamed evaluator response. The user accepted deferring ordinary streaming/tool/reasoning integration to [#189](https://github.com/AchuAshwath/LinkX/issues/189). The [research note](../research/browser-context-streaming-integration-2026-10-31.md) compares a readiness-only gate plus normal streaming with a request-scoped browser evidence tool, and identifies persistence ownership and post-output fallback prerequisites. This follow-up remains open after the current stack merges.
