# Browser Tesseract.js check (v1)

**Archived exploratory report; not reproducible from the current checkout.** The isolated `/tmp/linkx-observation-coordination/browser-ocr-v1/` harness and its raw `results.json`, `metrics.json`, and PNG inputs are no longer available. This file retains the recorded summary only. The old reproduction command below pointed at files and a fixture checkout that no longer exist; those instructions have been removed rather than presented as runnable. The integrated lab labels this content as report-summary evidence and does not reconstruct raw OCR output.

Run date: 2026-10-18 UTC. This is a small feasibility check, not a benchmark: six controlled, fictional 1280×900 PNGs; one observation per fixture per policy. No model API or native OCR engine was used.

## Setup

- macOS 15.7.7 (24G720), Apple M4 / arm64; Google Chrome 155.0.8059.82, headless browser launched by Playwright from the existing LinkX frontend install; Bun 1.4.2 / Node 26.7.0.
- Scratch dependency: `tesseract.js@6.0.1`; package resolved Tesseract core `6.1.2`; browser OCR engine reports `5.1.0-284-g9c08`. English data URL is `@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz` (4.0.0 best-int family). SIMD LSTM WASM core was selected.
- Browser worker, core, and language assets all returned HTTP 200 from jsDelivr in the archived run. Exact per-run URLs and requests are unavailable with the missing raw harness.
- Called `createWorker("eng", 1, ...)`; requested `{ text: true, blocks: true, layoutBlocks: true }`; no custom page segmentation in baseline. Tesseract.js cache disabled. Six isolated browser contexts each created a fresh worker for one fixture. Separately, one worker was initialized, warmed on the poster, and reused for six sequential fixture recognitions. “Cold” means fresh worker/context, not guaranteed cold CDN/network or OS caches.

## Measurements

Baseline medians across n=6: fresh worker ready 781.9 ms (range 588.0–913.4); OCR after ready 136.5 ms (56.6–204.5); combined first-result latency 887.3 ms (740.4–1091.0). Reused worker OCR median 94.5 ms (29.3–181.3). With only six single samples, ranges are more useful than tail percentiles.

Against visible fixture text (lowercased `[a-z0-9]+` tokens, punctuation ignored), baseline ordered WER was reported as 30/123 = 24.4%; sorting token multisets before Levenshtein gives 17/123 = 13.8%, which hides reading-order errors and is diagnostic only. Raw per-fixture text and boxes are unavailable in this checkout.

Four fixtures were exact after normalization: zoom-200, zoom-400, clipped and scroll-100. The image poster returned empty text (0 confidence, no blocks) in baseline and also remained empty with a single-block PSM 6 attempt and 2× canvas upscale. On the two-column fixture, baseline read across rows rather than the fixture’s column-major order and merged “A new” into “Anew”; confidence was 95, demonstrating confidence is not an accuracy guarantee.

A targeted separate PSM 11 sparse-text candidate was tried on the poster and columns; it is in `psm11-candidate.json` and excluded from baseline scores. It still returned no poster text. For columns it recognized the text (with the same Anew merge) in row-major order, so it did not recover the expected reading order. It introduced spurious vertical-bar tokens from panel borders. This is not a policy win on this set.

## Reproduction status

There is no runnable browser-Tesseract harness or raw run bundle in this repository. Do not treat the archived values as a reproducible final benchmark. The current lab page reproduces the synthetic fixtures and displays these findings as attributed summaries; it does not run OCR. A new OCR evaluation requires a fresh, version-pinned harness, preserved raw outputs and inputs, and criteria recorded before execution.

## Limits

The set is intentionally small, synthetic and English-only; results say nothing about general webpage OCR, language coverage, accessibility, or real-user latency. CDN fetches mean this test does not establish offline/local-only deployment. Run-to-run timing noise, browser/OS cache state, device load and quality on real pages remain unmeasured. No OCR confidence calibration was performed.
