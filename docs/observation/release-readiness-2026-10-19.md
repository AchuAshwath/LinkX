# Current-view observation: review readiness — 19 October 2026

## Delivered scope

The local desktop baseline is ready for pull-request review after the [initial audit](final-audit-2026-10-19.md) and follow-up fixes. A user selects a browser tab, sees the approved movable preview, and explicitly submits one current frame with each question. LinkX sends that frame through a restricted vision path, bounds estimated input plus output reserve, and excludes the frame from persisted conversation history. The disclosure starts collapsed and reports actual application budget estimates, frame/revision metadata, and the absence of historical images.

This delivers both tracks: the product implementation and the controlled lab/research evidence. It does not implement every proposed optional method. The [gate decision](experiment-decision-2026-10-19.md) explicitly defers automatic accepted-view history (#159), product OCR readback (#160), and recent-view comparisons (#161). Those are documented research outcomes, not delivered features or silent omissions.

## Standards findings resolved

- Preview measurement, geometry and dragging are cohesive modules. The former 4.36 mean-complexity failure is removed without changing radius, placement, movement, or close behavior.
- JPEG validation uses keyword-only arguments.
- Observation route tests live separately from ordinary chat route tests. Provider failure/cancellation tests share a parameterized behavioral test.
- Stream handling and race-test setup were extracted to respect function-length gates. No quality threshold was weakened.
- The complete CodeScene run includes new files via a disposable Git index; the ordinary working index is not used to manufacture coverage.

## Spec and adversarial findings resolved

- **Usage/evidence visibility:** `observation_usage` SSE contains actual estimated input, cap, output reserve, model and submitted revision/dimensions/times. It contains no raw image, source excerpt, session identifier or sensitive hash and is not persisted to the transcript.
- **Reset race:** a controlled external stream reproduced late usage arriving after Reset. Generation/controller checks now reject that metadata while allowing the already-authorized answer to continue. Replacement streams cannot be overwritten by late old-stream metadata or have their controller cleared by old cleanup.
- **Minimal UI and expiry:** details remain collapsed. Reset, reload and chat changes expire the local context; previous answers remain text only. Provider retention is disclosed separately. Local-readable times retain full ISO values in tooltips.
- **Reproducible OCR comparison:** the lab shows the exact six fixture PNGs, ground truth and preserved native Vision outputs, including fresh/reused-process measurements. The ordered-text gate failed because of column ordering. The old Tesseract run is explicitly archived; missing raw transcripts are not reconstructed. Corrections/skip are page-session-only and excluded from aggregate export.
- **Integrated evidence:** a clean disposable-account run records two live-provider questions, native tab capture, revision advance, no transcript images, keyboard details/reset/reload, measured timing stages, and a two-window recording. The lab walkthrough is recorded too.
- **Demo cleanup:** independent review caught setup/delete failure paths that skipped browser cleanup. Setup is now inside the cleanup scope and each release is independent. An unavailable-API probe confirms browser/context cleanup and no retained Playwright Chrome process.

## Issue disposition for this PR

| Issue | Disposition |
| --- | --- |
| #152 | Controlled fictional lab, provenance, replay/export, browser tests and walkthrough delivered. |
| #153 | Current-only capture lifecycle and approved preview delivered; submission revision is inspectable in details. The accepted minimal UI replaces a durable image inspector. |
| #154 | Capture experiment and fallback decision delivered. Automatic settling candidates remain rejected; earlier exploratory experiments are not retrospectively called preregistered. |
| #155 | Local OCR experiment and actual comparison/correction UI delivered. Product OCR rejected by the current gate. |
| #156 | Transient restricted current-view Q&A delivered, with two-view integration evidence and sanitized failures. |
| #157 | Budget/usage/expiry disclosure and 30-turn no-replay route regression delivered. Counts are estimates, not provider-reported tokens. |
| #158 | Comparison evidence and explicit current-view selection/conditional dispositions delivered; broader quality conclusions remain unproven. |
| #159–161 | Explicitly deferred; no automatic history, product OCR readback, or historical comparison claimed. |
| #162 | Scoped developer-run raster reading/keyboard task and evidence delivered; no screen-reader speech, participant, disability, or legal validation claimed. |
| #163 | Runnable integrated demo, recordings, measured cold/warm browser-session stages and limitations delivered. |
| #150 | Current-view research increment delivered for review; future methods and contractual interpretation remain separate. |

## Verification

The following checks passed against the final implementation and its organized regression suite. Source and artifact checks are scoped: browser/component regressions do not prove all browsers work; a mocked provider establishes structural isolation/boundedness rather than general answer quality.

- Full backend suite: **828 passed in 193.40 seconds**, including repeated observation requests and ordinary chat regression coverage; focused observation set after test organization: **30 passed**.
- Full frontend unit suite: **266 passed**; lint, typecheck, production build and regenerated client: **passed**.
- Lab browser suite: **5 Playwright tests passed**, including correction/skip and export exclusion.
- Floating preview browser harness: **passed** for equal corners/aspect fit, hidden-at-rest X, keyboard focus, drag, insufficient-space hide/restore, stop/restart and focus return.
- Real configured-provider integration: **two final questions passed** with one current frame and zero prior frames; no screenshot/packet in transcript readback; keyboard details/reset/reload passed. [Result and timings](evidence/final-demo/REPORT.md).
- Backend Ruff/format and mypy: **passed**.
- CodeScene full working-tree delta: **passed**, 61 eligible files checked across 118 modified paths, zero degradations/findings.

Existing tool output includes Vite size/deprecation notices, Node localStorage notices, and a LiteLLM logging-to-closed-stream message after pytest success. These do not fail the checks; no claim of warning-free tooling is made. [Research decisions](experiment-decision-2026-10-19.md) and [integrated evidence](evidence/final-demo/REPORT.md) document limits rather than treating technical success as a legal conclusion.
