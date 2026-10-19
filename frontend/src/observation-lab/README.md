# Observation fixture lab

This local, standalone Vite page replays fictional reading scenarios and compares the exact synthetic PNGs used in the native macOS Vision rerun with fixture ground truth, actual fresh-process and reused-process OCR text, and a separately attributed archived browser Tesseract summary. Fixture text and ground truth are owned by this repository and stay in `fixtures.ts`; the set records original fictional copy and the repository MIT license. The comparison provides a correction field and skip action held only in page memory. The exporter emits only aggregate replay metrics and excludes correction content, OCR text, OCR summaries, raw frames, and ground truth.

Start the frontend with `bun run dev` and open `/observation-lab.html`. Choose a scenario, set the sampling rate and settle window, replay its frames, inspect visible blocks and accepted/missed outcomes, then download the JSON report. Replay timing follows fixture timestamps. The replay does not inspect a live source page, call a model, upload frames, or log fixture text.

Run the public export flow in installed Google Chrome with:

```bash
bunx playwright test --config=playwright.observation-lab.config.ts
```

The standalone Playwright config uses port 4012 because the main Vite server is configured for port 4000 and the repo-wide Playwright config currently expects port 5173. Tests cover the visible comparison, correction/skip flow, aggregate export boundary, reduced motion and zoom replay.

Generate a short browser walkthrough recording outside the checkout (Chrome and Playwright must be available):

```bash
node scripts/observation-lab/record-walkthrough.mjs /tmp/linkx-observation-lab-walkthrough.webm
```

The script uses port 4003 and records fixture replay plus the actual native Vision text, archived Tesseract summary, and correction UI. It creates a local synthetic-only video; it does not show a live source page or make provider requests. The archived browser Tesseract report is not reproducible from the current checkout; its report-summary status and limitations appear in the comparison panel and decision record.

Scenario set `2026-10-18.2` includes scroll overlap with an animated sidebar, small text at 200%/400% zoom, two-column order, clipped cards, repeated quotes with changing counters, and text styled as an image poster. The replay applies a small deterministic sampling and settling policy to scripted frames and compares its outcomes with fixture expectations. Reports carry `measurementMode: scripted-fixture-policy-replay`. Processing, upload, and provider latency have zero samples and export as unavailable; this replay is not provider or real-device measurement. The native OCR rerun protocol, ordered WER, timings, and reproduction command are in `docs/observation/evidence/native-ocr-final-2026-10-19/REPORT.md`.
