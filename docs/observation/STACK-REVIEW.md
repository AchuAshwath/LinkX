# Browser reading review stack

The current demo was accepted in a manual smoke review on 25 October 2026. This stack separates the implementation and follow-up fixes for review. Each PR targets the preceding branch; review in this order. Nothing has been merged.

| Layer | Review | Scope and issues |
| --- | --- | --- |
| 1 | [PR182](https://github.com/AchuAshwath/LinkX/pull/182) | Bounded reading API, strict model output, budgets; #168, #175, #181 |
| 2 | [PR183](https://github.com/AchuAshwath/LinkX/pull/183) | Incremental question API, ordinary-turn persistence, awareness and naming; #161, #176, #180 |
| 3 | [PR184](https://github.com/AchuAshwath/LinkX/pull/184) | Pure temporary memory and activity types; #171 |
| 4 | [PR185](https://github.com/AchuAshwath/LinkX/pull/185) | Chat-owned capture/session, queued questions, image activity and terminal errors; #159, #161, #176, #177 |
| 5 | [PR186](https://github.com/AchuAshwath/LinkX/pull/186) | Late voice results and newer-draft preservation; #178 |
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
