# Browser worker OCR evidence v1

## Scope and result

This feasibility check ran Tesseract.js in a browser worker against six fictional 1280×900 PNG views. It does not establish OCR quality on a representative webpage set, offline operation, accessibility outcomes, or production latency.

On macOS 15.7.7 (24G720), Apple M4/arm64, headless Chrome 155.0.8059.82, Bun 1.4.2, and Node 26.7.0, the harness used `tesseract.js@6.0.1`, Tesseract core `6.1.2`, the WASM SIMD LSTM engine, and English `4.0.0_best_int` trained data. The worker, WASM core, and trained data loaded from jsDelivr with HTTP 200 responses. Recognition ran locally in the browser after those assets loaded; this does not establish offline use.

Four of six views were exact after lowercase alphanumeric normalization. Ordered word error rate was **30/123 (24.4%)**; sorted-token lexical WER was **17/123 (13.8%)**, a diagnostic that hides reading-order failures. The poster view returned no text in baseline, single-block PSM 6, and 2× upscale attempts. The two-column view was returned row-major rather than column-major and merged “A new” into “Anew”; its confidence score was 95.

| Measurement | Median | Range / count |
|---|---:|---:|
| Fresh worker ready | 781.9 ms | 588.0–913.4 ms, n=6 |
| OCR after fresh worker ready | 136.5 ms | 56.6–204.5 ms, n=6 |
| Fresh worker to first result | 887.3 ms | 740.4–1091.0 ms, n=6 |
| Reused worker OCR | 94.5 ms | 29.3–181.3 ms, n=6 |

The fresh runs used a new browser context and worker for each image, but do not guarantee cold CDN, operating-system, or hardware caches. The reused-worker run initialized one worker, warmed it on the poster, then recognized each of the six images once. These six-sample timings are exploratory, not stable latency estimates.

## Decision

This result is **not sufficient to approve browser-worker OCR for production readback or model context**. The empty poster result and two-column ordering error show concrete gaps on this small set. Keep the supported demo on the current-frame direct-image path; do not enable OCR by default. Gate B stays inconclusive for a broader OCR choice. This browser-worker result is separate from the earlier native macOS Vision experiment and from the local-proxy model comparisons; their quality and timing results do not transfer to Tesseract.js.

Gate D supports only a one-developer synthetic image-text task and developer interaction checks. No participant or disability validation is claimed. The fixture task script and separate facilitator ground truth are at `/tmp/linkx-observation-coordination/accessibility-v1/task-and-ground-truth.md`.

## Reproduction and raw evidence

The isolated harness is `/tmp/linkx-observation-coordination/browser-ocr-v1/`. It contains the exact PNG inputs, `run.mjs`, browser page, lockfile, and separate PSM 11/PSM 6/upscale experiment. From that directory, install with `bun install`, start Vite at `127.0.0.1:4012` using the report's scratch command, then run `node run.mjs`. The runner uses machine-specific Chrome and existing Playwright paths; adjust those paths on another machine. It writes `results.json`, so preserve the supplied file before rerunning.

Raw files and SHA-256:

- `results.json`: `9f7fdfb67bb2154af16252e546677e0c9df9d029548c0c099d527a5f4cb85105`
- `metrics.json`: `f2112baeb6a8b99c94342b6cf18789d49b48b955ba5f0677fe5a1f22cb63e680`
- `psm11-candidate.json`: `6b9a489bb3ab3d3ca783fa5cc3d01e83e842867c05453d59756b8824eac252cf`
- `REPORT.md`: `a2f19cd35e225c2a372be36cf725cf565dc12d9ce5ed678b7ed7310d2cd8dc54`

The raw PNG inputs match the six inputs in `ocr-inputs/`; hashes appear in the scratch `SHA256SUMS.txt`. Ground truth comes from the visible fixture blocks in [`fixtures.ts`](../../src/observation-lab/fixtures.ts), not from runtime or observer access.
