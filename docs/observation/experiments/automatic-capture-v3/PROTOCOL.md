# Automatic capture v3 validation protocol

This harness compares the pixel-only capture pipeline with independent source-page ground truth. It uses a controlled long page rendered in Chromium and passes only screenshot-derived native RGBA pixels and frame metadata to `createCapturePipeline`. Test telemetry is collected after each offer and remains in the runner for scoring; it is never attached to a frame or passed into the pipeline.

The fixture includes 48 readable sections, deliberately repeated paragraphs, sticky header and sidebar furniture, an independently animated badge, lazy images, a controlled 44→45 change, an isolated single-letter edit, a negation edit, a reflow, and a zoom. It exercises a separate initial capture with the badge animating, then slow, tight, fast, reverse, pause, and long-traverse movement. The fast profile deliberately moves farther than one viewport so the harness can detect content crossed between samples. A separate full-page pass advances by 0.60 viewport heights, dwells for at least 1,000 ms at each position, and samples every 250 ms through the bottom. Captures use Playwright screenshots from the rendered source viewport, decoded into RGBA in a separate observer page. No model, browser extension, or capture hook is used.

## Run

Start the existing Vite frontend on port 4000, then run:

```bash
cd frontend
CAPTURE_V3_ORIGIN=http://127.0.0.1:4000 node scripts/observation-lab/automatic-capture-v3/validation-run.mjs
```

The runner writes one bounded JSON record to `/tmp/linkx-capture-v3-validation/result.json` by default. Set `CAPTURE_V3_OUTPUT` to retain results elsewhere. By default it saves no images. For matcher debugging, `CAPTURE_V3_SAVE_SAMPLE_IMAGES=1` saves no more than two controlled-fixture PNGs for the first eligible accepted overlap pair. A run reports `defer` if Vite, the fixture, Playwright Chromium, or the pipeline module is unavailable. It reports `fail` when a predeclared gate is missed and `measured` when all gates pass.

## Scoring and provisional gates

The runner offers screenshots at a 250 ms cadence during fixed dwell periods and samples every 250 ms during the slow full-page traverse. It records every offered frame, pipeline decision, emitted candidate metadata (never the encoded image), observation kind, gap, processing time, and `stats()` result. It separately records source article IDs and their visible area, scroll positions, viewport dimensions, controlled edits, reflow, and zoom. An article counts as visible only when at least 25% of its area intersects the viewport below the sticky header. This prevents tiny edge slivers from making coverage appear complete. The runner checks that the decoded screenshot matches the rendered viewport size and contains foreground text pixels. This makes source delivery failures distinguishable from registration or classification failures. It clears the pipeline at the end and checks that pixel buffers, pending candidates, and anchors have been released. Any browser page or console error fails the run.

The first integration gate is intentionally strict about false continuity and small edits:

| Measure | Provisional gate |
| --- | --- |
| Confident overlap/revision/revisit when source viewports are disjoint | 0 |
| Recall of the 44→45, single-letter, and negation revisions | 100% |
| Useful-link rate | Greater than 0% of consecutive accepted-candidate pairs that source telemetry labels as eligible overlaps; the estimated shift must be within 8 px of source scroll displacement |
| Slow full-page source delivery | All 48 article markers must be visible to the sampler at least once during the full traverse, which must reach the document bottom |
| Slow full-page candidate coverage | At least 95% of article markers visible over 25% of their area must have a candidate; if the traverse reaches the bottom, all 48 markers must have candidates |
| Anchor retention | At most 3 anchors and at most 12 MiB, matching production defaults |
| Pipeline offer handling p95 | At most 100 ms per frame on the test machine |
| Initial candidate with independent animation active | At least one candidate during the animated initial-settle case |

These are experiment gates, not calibrated product SLOs. The zero-false-join gate has priority over coverage; the useful-link and revision gates prevent a matcher from passing by rejecting every pair. Full-page coverage is evaluated independently from fast movement: the slow pass establishes whether repeated stable sampling can produce candidates across the article, while the fast burst reports skipped source regions without demanding that fast scrolling expose every region.

The source telemetry is used only to label pairs after the pixel-only call. Expected `shiftY` is measured between the source positions of consecutive accepted candidates, because the tracker only advances its alignment anchor for accepted candidates. The runner identifies a disjoint pair from non-overlapping source viewport intervals and identifies revisions from controlled values. No DOM label, scroll offset, or fixture region identifier is available to the pipeline. It reports test-only skipped source region IDs and summarizes each accepted-candidate interval that crossed them, including its `observation.kind`/reason and any `onGap` callbacks. Registration’s `unaligned` result is an algorithmic segment break; an `onGap` callback is a separate pipeline event such as a dropped or replaced pending candidate. The DOM IDs remain ground truth and are never sent to the pipeline. Candidate vertical coverage is also reported as the union of candidate viewport intervals over the document height, with the fixed header excluded.

## Interpretation and next gate

First inspect the `status` and `failures` fields. Failure to emit during the animated initial case indicates an admission problem. Low candidate coverage or source capture errors indicate delivery/admission trouble. A candidate with the wrong `observation.kind`, shift, confidence, or segment indicates registration/classification error. Skipped source regions are independent coverage evidence; a pairwise registration result cannot prove those regions were read. `sampleHandlingP95Ms` measures synchronous `offer` plus `takePending`; it excludes Playwright screenshot time and therefore is not end-to-end capture latency. `peakRssBytes` is process-wide diagnostic context; use pipeline anchor count/bytes for the retention gate.

After the controlled fixture passes, repeat the three public article sources listed in `validation-native.mjs` with headed native tab capture and source/video preflight enabled. Preserve only bounded crops or a few sampled frames, plus JSON metrics; do not save full article archives. Run that headed pass separately from any other active Chrome capture session. Add real-source results as a separate artifact so public-page navigation, lazy loading, or capture delivery cannot be mistaken for an algorithm failure. Only after both controlled and real-source capture gates pass should sequential model interpretation trials resume.

## Continuous scrolling and native delivery

Settled scroll steps do not establish that readable intermediate views survive uninterrupted scrolling. Three separate checks exercise that behavior:

- `validation-continuous.mjs` offers synthetic full-pixel frames at 250 ms intervals during a 12 second scroll. It checks intermediate admissions and bounded motion-probe storage.
- `validation-continuous-browser.mjs` replays actual rendered source screenshots at 250 ms logical intervals over 2,340 CSS pixels. Its gates require at least five intermediate captures and at least 95% union coverage of the independently recorded source viewport intervals. This is a screenshot replay, not native shared-video delivery.
- `validation-native.mjs --continuous-only` uses the actual `getDisplayMedia` stream and capture page. It scrolls by 20 CSS pixels every 80 ms for 120 steps, with no intentional reading pauses. It requires at least four candidates admitted specifically by the coherent-scroll path before the final pause. It also fails if sampled source travel between observed increases in capture count exceeds one source viewport. That travel check includes the initial and final intervals; it is approximate capture-progress telemetry, not exact source-image correspondence or semantic coverage. Run again with `--blogs --continuous-only` for the three public articles, or add `--article=web-dev` to isolate a source. The native gate checks intermediate capture and source/video agreement; it does not establish exact full-page semantic coverage.

Native runs compare a downscaled source screenshot with the shared video before testing, verify aspect ratio and native dimensions, and check buffer release after Stop. Source scroll offsets remain test telemetry and never enter the pipeline. Capture and delivery timings include the machine's native resolution; the replay's logical sampling cadence is not an end-to-end latency measurement. Do not run two headed capture sessions together or combine native performance measurements with a parallel browser stress run.

The optional native `--debug-pairs` flag retains at most three adjacent before/after frame pairs for diagnosing geometry. It adds encoding work and its timings must not be used as performance evidence. Routine validation saves JSON metadata and a bounded lab screenshot instead of article image archives.

## Controlled baseline on 2026-10-20

The headless Chromium run on 2026-10-20 passed all harness gates with production pipeline defaults: 291 screenshot offers, 76 accepted candidates, zero browser errors, zero disjoint confident joins, and 3/3 controlled revisions detected. Of 66 accepted-candidate pairs eligible for overlap evaluation, 42 had the correct overlap classification and shift within 8 px (63.6%). The slow traverse moved 540 px per step, sampled every 250 ms during 1,000 ms dwell periods, reached the bottom after 35 steps, and produced candidates covering all 48 article markers. Candidate viewport intervals covered 97.0% of document height; the remaining interval reflects candidate selection and the sticky header exclusion. Offer plus `takePending` p95 was 56 ms. Pipeline clear reduced retained pixel bytes, pending candidates, and anchor count/bytes to zero. The separate fast burst crossed 18 unseen article regions; the pipeline emitted an `unaligned` observation with reason `no-confident-overlap` across that accepted-candidate interval.

The compact source-and-decision record is [raw/validation-headless-2026-10-20.json](raw/validation-headless-2026-10-20.json). It contains per-sample test-only source positions and visible article IDs alongside pixel-only pipeline outcomes, with no screenshot payloads or model calls. This is a controlled fixture result; public-article native capture remains a separate validation step.

## Final candidate on 2026-10-21

After the high-DPI, thin-text, and dense fixed-furniture corrections, the final controlled run again passes with 291 offers, 76 candidates, 48/48 section markers, 3/3 small edits, zero disjoint confident joins, and 42/66 correct eligible overlap links. Offer handling p95 is 57.8ms. The final actual-rendered continuous replay retains 13 coherent intermediate views with 100% measured interval coverage. Actual native continuous sharing passes on the fixture and all three public articles, with web.dev passing twice consecutively. See [REPORT.md](REPORT.md) for the native dimensions, progress metrics, latency, limitations, and manual test gate, and [raw/validation-headless-2026-10-21.json](raw/validation-headless-2026-10-21.json) for the final controlled record.
