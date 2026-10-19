# Observation experiment decisions — 19 October 2026

## Decision record and timing of criteria

This record is written after the experiments summarized below. The criteria in this file are prospective decision rules for any future final run; they were not preregistered criteria for the earlier runs. Existing measurements are exploratory and are assessed against the criteria as a retrospective comparison. No claim of preregistration or confirmatory evaluation is made.

## Gate decisions

| Gate | Decision | Evidence and limit |
| --- | --- | --- |
| A · View selection and history | Select the user-requested current view when the user presses Send. Defer automatic accepted-view history and coverage UI. | The capture experiments show animation-driven duplicate candidates and starvation risks for automatic selection. A fresh user-selected frame is the clearest bounded input for the implemented baseline. The experiments used a local synthetic browser surface and do not validate all capture environments. |
| B · Local OCR | Do not enable browser Tesseract as the default or product readback. Keep OCR experimental. | The archived six-view synthetic Tesseract run reports ordered WER of 30/123 (24.4%), an empty poster, and row-major columns. The new native Vision rerun, after criteria were recorded, scores 28/123 ordered errors (22.76% WER); every error is the two-column ordering failure, while all six images are non-empty. It fails the prospective 98% Gate B screen. Native macOS results do not establish browser OCR parity or general accuracy. |
| C · Model context | Select the current-view direct-image request on Send. Defer historical-view OCR/model context. | The small local-proxy comparison answered six known current-view questions with both direct image and extracted text, and three historical questions with explicitly labeled OCR. Current-only correctly disclosed unavailable earlier details. The sample did not test production provenance enforcement, representative accuracy, or characterized provider behavior. |
| D · Accessibility research | Keep the synthetic fixture task as a developer-run lab prototype. Make no participant, disability-validation, screen-reader, legal, or platform-policy conclusion. | The existing task is one fictional image with developer checks. It is useful for procedural exploration only. No participants or screen-reader task were involved. |

## Criteria for any new final evaluation

Record these criteria before running a new confirmatory evaluation. The current evidence does not meet that status.

- **Gate A:** A selected current frame must be available on explicit Send, with no hidden background inference. Any automatic view history must demonstrate fresh-view coverage, bounded memory, and a visible expiry state without accepting an animation-only duplicate in the declared fixture suite. Failure or incomplete coverage keeps automatic acceptance deferred.
- **Gate B:** OCR may be considered for a narrowly scoped product readback only if a predeclared representative fixture set meets at least 98% ordered token accuracy, returns non-empty text for every required text-bearing fixture (including poster-like text), and stays within a declared latency and offline/network policy. A reading-order mismatch, empty required fixture, or undeclared asset fetch fails the gate. Passing a synthetic set alone would still not establish general accuracy.
- **Gate C:** Historical OCR/model context may be considered only if each text segment carries a verifiable source-view revision and timestamp, provenance cannot be confused with the current image, stale evidence is disclosed, and the predeclared task suite improves earlier-view answer coverage without reducing current-view accuracy or hiding uncertainty. Otherwise current-only context remains selected.
- **Gate D:** Claims about accessibility outcomes require a separately designed participant study with appropriate consent and accessibility expertise. Developer-only browser checks cannot satisfy that gate.

Thresholds above are prospective screening criteria chosen for the next run, not claims derived from prior research or legal requirements. A future protocol should state fixture selection, exclusions, environment, and analysis before the run begins.

## Native Vision rerun protocol (recorded before this run)

Before the new native OCR run on 19 October 2026, I selected the six representative fixture images in `capture-frames.ts` and fixed the configuration to macOS Vision `accurate`, `en-US`, language correction enabled, with one recognition request per image. I will retain OCR lines and confidence values. Ordered WER will use lowercase `[a-z0-9]+` tokens in the observed top-to-bottom line order, compared with each image's visible fixture text in the fixture's declared reading order; no token sorting or punctuation-only edits will be hidden. I will report per-image and pooled word counts/errors and mark empty output as a failure for each text-bearing fixture. The Gate B screen is >=98% pooled ordered token accuracy and non-empty output for every required image; passing this synthetic set alone cannot approve production OCR.

Timing will include two modes on the same six PNGs: six fresh executable processes, one image per process, and one reused process handling all six images. The harness will separately record total process wall time and Vision `perform` time; their difference is only a process/setup/decoding/serialization overhead estimate, not isolated application startup. Compilation is excluded from both. The fresh-process and reused-process runs will use the same PNGs and settings. This does not measure browser Tesseract or establish engine parity.

## Conditional issue disposition

- **#159 — automatic view policy and coverage:** defer. The current-view-on-Send baseline is selected; automatic history and accepted-view count/expiry UI are not implemented or approved.
- **#160 — local OCR readback:** defer. The synthetic OCR evidence is too narrow to approve a product default. The integrated comparison panel displays actual native Vision text for all six fixtures, an attributed archived Tesseract summary where available, and accepts corrections in memory for the page session.
- **#161 — recent-view comparison:** defer. Historical OCR context remains unapproved pending provenance and Gate C evidence.

These are local research dispositions. They do not update GitHub issue states.

## Supported scope

The supported observation path is a user-selected current view submitted explicitly on Send. The limited synthetic lab can replay fictional fixtures, display generated fixture images and ground truth beside actual native Vision output and attributed archived Tesseract summaries, accept a temporary correction or skip decision in page memory, and export aggregate replay metrics. It does not upload fixture images, transmit ground truth or corrections, persist corrections, provide OCR to product chat, retain accepted-view history, or make a general accuracy, accessibility, provider-retention, terms-of-service, or legal claim.

The lab comparison labels each source separately: the current native Vision run has preserved per-image transcripts; the prior browser Tesseract run has only an archived summary because its raw transcript bundle is missing. It does not reconstruct missing Tesseract output. See [browser Tesseract evidence](evidence/browser-tesseract-v1.md), [native Vision rerun](evidence/native-ocr-final-2026-10-19/REPORT.md), [native Vision experiment](../../frontend/scripts/observation-lab/OCR_EVIDENCE.md), and [model comparison](../../frontend/scripts/observation-lab/MODEL_COMPARISON.md).
