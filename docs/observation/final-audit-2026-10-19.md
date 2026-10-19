# Observation implementation and research audit — 19 October 2026

## Follow-up

This is the historical pre-fix audit. The implementation follow-up adds usage/evidence details, cohesive geometry/drag modules, keyword-only JPEG validation, actual preserved native OCR comparison/correction controls, a final gate decision record, and recorded real-provider/keyboard integration evidence. See [release readiness](release-readiness-2026-10-19.md) for the current verification and disposition; the original findings below explain what triggered the work.

## Original verdict

The current-view desktop demo works in the checked paths. Independent Luna reviews found no confirmed functional P1/P2 defect in the frontend or backend. This is not a guarantee that every failure mode has been exhausted.

The implementation and audit/research tracks do **not** yet satisfy every acceptance criterion in parent #150 and children #152–#163. In particular, the complete CodeScene check fails, usage is not surfaced in the product, and the integrated research/demo evidence package is incomplete. All twelve GitHub child issues remain open. This audit did not comment on, close, or rewrite issues, change the implementation, or commit code.

Scope: `/Users/ashwath/.codex/worktrees/b6a7/LinkX`, starting commit `0914522f94aaf26cf2080d4845fd77fa3aeb4b6d`, tracked modifications plus new observation source, tests, and evidence. User-approved UI changes supersede the old Observe Tab label, persistent chip, and verbose preview presentation.

## Standards review

1. **Quality gate failure:** `frontend/src/observation/useFloatingPreviewPosition.ts` has module mean cyclomatic complexity **4.36 across 14 functions**, above the configured threshold of **4.0**. The complete disposable-index CodeScene analysis checked **52 eligible files across 85 modified paths** and reported one degraded module. Refactor the geometry/interaction responsibilities before claiming the repo's quality gates pass. Preserve the approved UI and behavior.
2. **Minor documented style violation:** `backend/app/models.py:493` defines `_validate_jpeg(data: bytes)` with a positional parameter. The repo requires keyword-only backend arguments. Convert this helper and its two call sites during cleanup.

An initial CodeScene call checked only the tracked changes (23 eligible files), passing while excluding new files. Its result is insufficient for the whole feature; the complete check above is authoritative.

## Behavioral review and attempted breakage

- Reviewed pending chooser cancellation, late resolution after stop, repeated start/stop, unsupported surfaces/audio, unmount and browser revocation.
- Reviewed capture ownership across new-thread handoff and unrelated thread navigation, immutable queued packets, mute/unmute and first-frame readiness, and normal attachment conflicts.
- Reviewed JPEG validation, declared/decoded dimensions, byte/pixel/count limits, model capability and input accounting, output reserve, ownership/authentication, sanitized error paths, and cancellation.
- Observation uses a direct model path without the agent tool runner or conversation screenshot history. Its transcript persistence excludes raw observation frames. These structural restrictions and regression checks are useful evidence; they do not establish general model accuracy or provider retention behavior.
- Re-ran headless Chrome against the actual preview, positioning hook and composer with a synthetic 1900×1000 stream. Frame and video dimensions match; all four corner radii match. Tested hover/keyboard X visibility, pointer drag, arrow movement, insufficient-space hide/restore, stop/restart through the + menu, and X focus return. The corrected audit harness exits successfully. This is a component integration harness, not a full native-picker end-to-end run.

No new model-provider requests were needed for this audit. The existing pixel-only grounding result remains one controlled synthetic example.

## Spec review and issue disposition

| Issue | Observed status | Remaining work or decision |
| --- | --- | --- |
| #152 controlled lab | Implemented prototype | Fictional fixtures, explicit MIT provenance, replay/export, and browser regression checks exist. A short recorded walkthrough remains a packaging item. |
| #153 live preview | Core implemented | Capture, approved floating UI, lifecycle, thread ownership and keyboard controls are covered. A formal selected-snapshot/revision inspector from the original spec is not present; reconcile it with the approved minimal preview scope. |
| #154 capture experiment | Experiment performed; automatic candidate rejected | Real capture experiments expose starvation/animation duplicates. Explicit fresh capture on Send is the documented fallback. The preregistered target/result artifact is incomplete. Do not claim a production detector was validated. |
| #155 OCR experiment | Limited prototype | Pinned browser-worker/native OCR reports document errors and cold/warm measurements. No production approval is established. The lab lacks the requested integrated image/ground-truth/OCR correction interface and declared decision criteria before evaluation. |
| #156 transient current-view Q&A | Core implemented | Restricted requests, immutable frames, limits, transcript exclusion and one live synthetic grounding result exist. The recorded two-question/manual-source-change demonstration and fuller integrated egress evidence remain incomplete. |
| #157 bounded turns and usage | Partial | A mocked-provider 30-turn route regression validly checks budget and no replay. User-facing, keyboard-accessible usage/coverage and explicit expired-evidence disclosure are absent. A live 30-provider-call run is not required by this criterion. |
| #158 strategy comparison | Partial experiment | Six matched current-view and three matched historical-view tasks compare direct image/OCR input forms. Scope/limits are documented; predeclared selection criteria and an integrated final decision package remain incomplete. |
| #159 automatic view policy/coverage | Deferred locally | Automatic acceptance is not approved; current-frame assistance remains usable. Accepted-view count/history/expiry UI is not implemented. This issue cannot be called implemented. |
| #160 local OCR readback | Deferred locally | Valid conditional outcome while readback is unapproved. The local demo notes document this choice; align GitHub disposition later. |
| #161 recent-view comparisons | Deferred locally | Valid conditional outcome while OCR context/provenance is unapproved. The product does not provide recent-view evidence. Align GitHub disposition later. |
| #162 accessibility prototype | Partial | Fictional raster task, keyboard/zoom checks and limits exist. An integrated assisted Q&A task, short recording/results and operation/egress evidence are incomplete. Participant research is not required for the limited prototype, and none is claimed. |
| #163 integrated demo/report | Partial | Runnable instructions and prototype reports exist. Missing integrated recording, accessible usage/coverage, and cold/warm end-to-end results/limitations package. Conditional issue statuses still need reconciliation. |

The issue text permits rejecting/defering optional OCR/history. Their absence alone is not a bug or a reason to block the useful current-view baseline. Completion requires explicitly accepting the narrower scope and recording those dispositions, rather than describing undelivered features as complete.

## Verification

- Frontend focused adversarial regressions: **112 tests, 9 files passed**.
- Frontend full suite from the immediately preceding unchanged implementation checkpoint: **262 tests passed**; typecheck, build and focused style checks passed.
- Browser lab: **3 Playwright tests passed** (export, reduced motion, zoom replay).
- Updated floating-preview browser harness: **passed**, including current radius/aspect assertions. Earlier QA's obsolete radius expectations were corrected in the temporary harness only.
- Backend focused observation/budget unit tests: **25 passed**.
- Backend Ruff check and format check: **passed**; mypy: **87 source files passed**.
- Full backend suite: **825 passed, 24 warnings in 208.10 seconds**, exit code 0. LiteLLM emitted a logging-to-closed-stream error during interpreter cleanup after pytest completed; it did not fail a test. This is recorded as a teardown limitation rather than an observation-path defect.
- CodeScene complete working-tree check: **failed**, one complexity finding described above.

Reports supporting the prototype decisions are linked from [current-view-demo.md](current-view-demo.md). A mocked integration test can establish request isolation and boundedness without establishing real-world model accuracy. Browser accessibility-tree checks do not substitute for a screen-reader task; the current report correctly makes no such claim.
