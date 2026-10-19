# Capture policy prototype v1

**Historical Canvas experiment; not reproducible from the current checkout.** The command originally referenced `scripts/observation-lab/capture-policy-prototype.ts`, which is no longer present, so the exact Canvas run described below cannot be regenerated from this repository. Related later `getDisplayMedia` experiments have runnable synthetic harnesses in [live-capture v1](../../frontend/scripts/observation-lab/live-capture-v1/REPORT.md) and [live-capture v2](../../frontend/scripts/observation-lab/live-capture-v2/REPORT.md); they use separate protocols and their results should not be attributed to this Canvas run.

## Question and recommendation

Can pixel novelty over a frame stream avoid redundant captures while still noticing a one-digit update and several small cumulative changes?

For this controlled Chrome Canvas frame stream, the most conservative measured candidate is **32×32 tiled change compared with the last accepted frame**, with a tile accepted when at least 8% of its pixels differ and the image is unchanged for 150 ms. Exact pixel equality against the last accepted frame suppresses duplicate acceptance. Keep this as a prototype Gate A candidate for the tested source/configuration. The result does not validate the policy against `getDisplayMedia`; the app-level Gate A default for live display capture remains unproven until measured through that source.

## Method

- Original command (archived only; its source file is missing): `cd frontend && bun run scripts/observation-lab/capture-policy-prototype.ts /tmp/linkx-observation-coordination/capture-policy-v1`
- Browser: headless Chrome 155.0.8059.82 through Playwright, viewport 1280×720, device scale factor 1.
- Host: macOS 15.6 (Darwin 24.6.0), arm64, Apple M4.
- Source: browser Canvas redraws rendered UI-like text and a small moving blue indicator. The detector reads actual `getImageData()` RGBA pixels from the rendered 1280×720 canvas, compares the pixels, then Playwright encodes accepted frames as JPEG quality 90 and PNG.
- Four policies were run serially over 64 samples: global threshold (0.3%) and tiled threshold (32px tiles, 8% changed-pixel ratio), each using either the initial image or last accepted image as novelty baseline. Pixels count as changed when maximum RGB channel delta is at least 24. An accepted pixel state is deduplicated exactly.
- Sampling waits 50 ms between draws and requires 150 ms of stable pixels. These are one fixed configuration, not a parameter sweep. The measured median interval between processed samples was about 145 ms (paused), 79 ms (animation), 194 ms (one-digit update), and 209 ms (cumulative updates); the four comparisons run serially, so these intervals include prototype workload and Playwright overhead.

## Results

| Scenario | Global / initial | Global / last accepted | Tiled / initial | Tiled / last accepted |
|---|---|---|---|---|
| Paused, 14 samples | 0 accepts; 0 false | 0; 0 | 0; 0 | 0; 0 |
| Small indicator animation, 20 samples | 0 accepts; 0 false | 0; 0 | 0; 0 | 0; 0 |
| One-digit counter update, 1 expected change | Missed 1 | Missed 1 | Accepted 1; 0 missed | Accepted 1; 0 missed |
| Four cumulative text additions | Accepted revisions 2–4; missed 1 | Accepted revisions 2 and 4; missed 2 | Accepted revisions 1–4; missed 0 | Accepted revisions 1–4; missed 0 |

There were no false accepts in the 34 no-change samples (paused plus animation) for any policy. Last-accepted baselines produced no duplicate candidates after acceptance. Anchor variants encountered the same changed visual state repeatedly (6 duplicate candidates for the small counter and 4 for tiled cumulative changes), but exact accepted-pixel deduplication prevented duplicate accepts.

Median RGBA compare time across samples was approximately 21–23 ms while paused, 6–7 ms during animation, 24–42 ms for the counter change, and 28–38 ms during cumulative changes. On accepted samples, pixel scan medians were about 24–49 ms. Playwright screenshot capture and JPEG+PNG encoding/transfer medians were about 130–151 ms. The full run took 11.1 seconds. Accepted JPEGs were 29,714 bytes for the counter and 33,417–43,864 bytes for cumulative additions. I visually inspected a 1280×720 JPEG and PNG: the 20px body text and 24px counter remained legible at the rendered size. This was a visual inspection, not an OCR or accessibility test.

## Limits

This experiment uses generated Canvas frames in headless Chrome. It measures real rendered pixels, pixel comparison, settling, and Playwright screenshot/encoding time, but does not measure browser display-capture delivery, frame cadence, permission/setup costs, browser compositor scaling, monitor color behavior, or real page animation patterns. The single animated indicator is a narrow false-positive check. The text and its content are both drawn by the fixture; this is not a platform accessibility result. No OCR or model was used.

Do not generalize these thresholds to all pages or browsers from this run. For live Chrome tab capture, repeat the same sequences through the actual captured video track and confirm frame cadence, novelty, accepted-frame legibility, and prepare latency before changing the product Gate A default.
