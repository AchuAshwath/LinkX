# Automatic capture v3 independent audit

The audit covered pixel admission, relative overlap, the shared-video stream, and the capture page lifecycle before model or hook work. I read the v3 protocol and browser-reading synthesis, exercised `createCapturePipeline` with controlled RGBA frames, and checked the capture page through the recorded headless lifecycle run. The focused audit tests are in [`audit-admission.test.mjs`](../../../../frontend/scripts/observation-lab/automatic-capture-v3/audit-admission.test.mjs).

## Resolved findings

- **Short and blank initial views:** Whole-frame stability now admits an unchanged initial viewport after its settle interval, even when it has too few informative tiles or only one text band. The stable one-line regression test passes.
- **Fixed furniture during scrolling:** Initial tile coverage now requires stable informative pixels to span 40% of the viewport width, including the tile extent. The 88 px sidebar in the 320 px fixture no longer qualifies while the article body moves; its regression test passes.
- **Canvas encoding failure:** Candidate admission now requires a supported image MIME type and base64 data URL. `data:,` produces an `encoding-failed` gap instead of a candidate, and the regression test passes.
- **Stale sequence delivery:** Frames with non-increasing sequence numbers in the same owner and generation are rejected as stale. The audit replay accepts sequence 13 and rejects delayed/repeated sequence 11; the regression test passes.
- **Reduced pixel detail:** Pixel validation now requires the buffer to match the declared full source dimensions. A thumbnail cannot enter the pipeline as though it were a full-resolution viewport; the regression test passes.
- **Source ending while preview playback starts:** The controller installs track listeners before awaiting video playback and checks track state after the await. The lifecycle run confirms that an ended source cannot leave the page in a live sharing state.

## Registration ambiguity

Byte-identical images at separate source positions cannot be distinguished from a true revisit using pixels alone. The tracker now reports exact pixel equality with `shiftY: null`, zero confidence, the matched sequence, and `identical-pixels-position-unknown`. This preserves the visual fact without claiming geometric continuity. It remains impossible to infer which repeated source position was seen from identical frames; no capture coverage is claimed for unseen or undelivered content.

## Verification and retention

`node --test frontend/scripts/observation-lab/automatic-capture-v3/{pipeline,registration,stream,audit-admission}.test.mjs` passes 44/44. The recorded headless UI lifecycle run passes 8/8 cases, including late picker completion, mute/end, manual stop, dialog close, and source end before `play()` resolves; it reports no model or API requests.

The inspected retention paths are bounded: source frames are limited to 8,388,608 pixels; the pipeline retains two pixel buffers and releases them on clear; registration retains at most 3 anchors and 12 MiB; the stream clears its canvas dimensions and cancels its video-frame callback on stop; UI previews are capped by count, encoded bytes, and pixel count, and are cleared on stop. The unit lifecycle test confirms zero retained pipeline pixels and anchor bytes after clear.

The remaining operational limit is sampling: fast scrolling can cross content between delivered frames. The pipeline cannot reconstruct a section that never appeared in a captured viewport, so the passing overlap checks do not establish complete reading coverage.

## Coherent-motion probe review

The continuous-scroll admission path uses a second, ephemeral tracker for at most one probe per configured interval. It compares only the immediately previous and current delivered full-pixel frames, requires a relative-overlap result with confidence and minimum displacement, and clears tracker anchors in `finally`; `clear()` also resets that tracker. The tracker is configured for one anchor and a 256 KiB budget. The edge/contrast test is a pixel-quality heuristic, not evidence that text is semantically legible or understood. Motion candidates therefore establish only a plausible relative viewport shift. Low-contrast content, missed delivery intervals, or ambiguous/repeated pixels can still leave gaps and are not described as complete capture.

The focused v3 suite, including the continuous-motion synthetic tests, passes 48/48. The tests verify motion candidates during 250 ms sampling, a bounded probe count and anchor budget, rejection of identical frames, unrelated scenes and blurred frames, and release of retained pixels/anchors after clear. The separate native continuous-scroll fixture is being run by the implementation owner and is not counted as independent audit verification here.

## Final review on 2026-10-21

The second Luna audit found that the first high-DPI correction did not exercise an odd displacement through a compressed row grid: the 1551px fixture kept native rows, while the 2160px fixture used an even displacement. An added 2161px / 121px case reproduced a missed overlap. Registration now prioritizes native source rows through 4096px and reduces feature width to fit the anchor-byte cap. The new odd-height regression passes without relaxing match or ambiguity thresholds. Integer grouping above that height maps relative displacement using its exact row scale.

The independent rereview confirmed the allocation bound: feature height cannot exceed the configured height or byte cap, and feature width cannot exceed the byte cap divided by height. Full-pixel anchor copies are separately conditional on the remaining budget. A portrait 2160×3840 test under the 256 KiB motion-probe budget deliberately expects uncertain alignment to be rejected. This is a limitation of useful links at that resolution and budget, not proof of uninterrupted reading coverage. Heights above 4096px can also miss or quantize small displacements after row grouping. A settled independent viewport remains eligible through normal admission.

The final combined public-interface run passes 93/93 tests: 53 v3 capture tests and 40 earlier capture, scheduling, and memory regressions. The UI lifecycle runner passes 8/8. Full frontend Biome checking exits successfully with existing warnings/informational notices; the frontend build passes with existing Vite plugin and bundle-size warnings. CodeScene's safeguard passes all 58 eligible files. No backend or model endpoint was involved in these capture checks.

The implementation owner's final controlled browser matrix passes all gates: 291 offers, 76 candidates, all 48 source-region markers covered during the slow traverse, 3/3 small revisions, and zero confident joins across disjoint viewports. It correctly links 42/66 eligible overlap pairs; the other pairs remain unaligned. The separate actual-rendered continuous replay retains 13 intermediate coherent-scroll candidates over 2340 CSS pixels with 100% measured viewport-interval coverage. Native sharing evidence and performance limits are recorded separately in the final report; screenshot replay is not treated as native delivery or semantic transcription verification.

## Dense fixed furniture and final native retest

A repeated native web.dev run exposed an intermittent miss despite the first native matrix passing. Saved source frames were sharp. Instrumentation showed that the correct 120px shift reached detailed verification, but matching article zones held only 57.8% of contrast-feature evidence because the fixed table of contents was unusually dense. A deterministic public-interface regression reproduced that rejection. The final quorum combines the moving evidence ratio and matching active-zone ratio with a geometric mean. This changes which marginal matches qualify; the same numeric threshold does not mean unchanged strictness. Detailed zone mismatch, combined mismatch, vertical-band evidence, and ambiguity gates remain unchanged. A separate thin-text regression justifies finer displacement sampling at the tested native feature heights.

Independent rereview found no blocker in the changed rule. All 21 registration tests pass, including the new positive cases and existing repeated-layout, stationary-header, unrelated-content, budget, and ownership rejections. Actual replay of all three failing web.dev image pairs now returns the independently measured 80/120/120px shifts. The native progress gate was strengthened to require coherent intermediate captures and to reject sampled source travel beyond one viewport without an increase in capture count.

The final native fixture and all three public articles pass that gate. Web.dev passes twice consecutively. The final controlled matrix was rerun after the support-policy change and still reports zero disjoint confident joins, 42/66 correct links, all 48 section markers, and 3/3 small edits; offer p95 is 57.8ms. Final native offer p95 is 176–209ms at 2880×1550. These results support the tested cases and manual handoff, not general all-page recall. See [REPORT.md](REPORT.md) and its linked raw evidence for the exact measurements and remaining resolution/layout limits.
