# Native macOS Vision rerun — 19 October 2026

## Protocol and decision

The run protocol and Gate B screening criteria were recorded in [the experiment decision record](../../experiment-decision-2026-10-19.md) before execution. This exploratory rerun used the six representative fixtures from the repository's capture harness, with Apple Vision `accurate`, `en-US`, and language correction enabled. The 1280×900 PNGs were generated locally from the fictional fixture source; no provider or network request was made.

The prospective screen was at least 98% pooled ordered-token accuracy and non-empty output for each required image. The run scored **28 errors / 123 expected tokens (22.76% ordered WER; 77.24% ordered token accuracy)**. All 28 errors came from the two-column fixture: Vision returned the right-column lines before and between the left-column lines, giving **28/28 (100%) ordered WER** despite recognizing every word. The other five images had 0 token errors, including the image-text poster. All six outputs were non-empty. The screen fails, so this run does not approve OCR readback. These synthetic results do not establish general OCR accuracy.

The Tesseract.js poster failure and row-major column result remain separate, archived browser-engine evidence. Native Vision results do not transfer to Tesseract or establish browser engine parity; Tesseract remains rejected as a product default.

## Timing

Environment: macOS 15.7.7, Apple M4 arm64, Swift 6.2.3. The Vision request revision followed the OS default. Raw per-image text, confidence, expected text, hashes, and timings are in [`results.json`](results.json); generated PNGs are kept under `/tmp/linkx-native-ocr-final-inputs` and can be recreated.

| Process mode | Process wall time | Vision recognition (`perform`) | Remaining process/setup estimate |
| --- | ---: | ---: | ---: |
| Six fresh executable processes, median per image (n=6) | 382.93 ms; range 366.33–871.55 ms | 325.98 ms; range 311.34–340.07 ms | median 59.33 ms; includes process startup, image decoding, request setup, and serialization |
| One process reused across six images | 790.49 ms total | 728.42 ms total | 62.07 ms for the full process |

The first fresh process took 871.55 ms wall time and 337.57 ms in Vision recognition, with a 533.98 ms remainder estimate. This suggests process-start cost in this run, but the remainder is not isolated startup measurement. The reused process's first image took 317.17 ms in Vision; the following five had a median 81.73 ms (range 68.84–99.37 ms). Operating-system and model caches were not controlled, so “fresh process” is not a guarantee of a cold system cache. Timing samples are small and exploratory.

## Reproduction

From `frontend/` on macOS with Bun, installed Google Chrome, Swift, and Xcode Command Line Tools:

```bash
bun scripts/observation-lab/run-native-ocr-final.mjs
```

The runner regenerates six fixture PNGs in `$TMPDIR/linkx-native-ocr-final-inputs`, copies the exact inputs used into `frontend/src/observation-lab/fixture-images/` for the side-by-side panel, compiles `VisionOCR.swift` once, performs six separate-process runs and one reused-process run, scores ordered token error against the fixture blocks, and writes this directory's `results.json` plus the lab's `src/observation-lab/native-ocr-final-2026-10-19.json`. SHA-256 hashes are recorded in [`SHA256SUMS.json`](SHA256SUMS.json).
