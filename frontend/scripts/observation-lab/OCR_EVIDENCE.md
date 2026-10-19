# Local OCR experiment: macOS Vision

## Setup

This experiment rasterizes six fictional fixture views in headless Chrome, then sends those PNGs to Apple's Vision `VNRecognizeTextRequest` from a Swift command-line harness. It makes no provider or network requests and adds no runtime dependency to the app. The sample views cover a scrolling feed, 200% and 400% zoom, two columns, a clipped card, and text styled as a poster image.

Environment: macOS 15.7.7, arm64, Swift 6.2.3, Chrome 155.0.8059.82. PNGs are 1280×900 pixels, captured at device scale factor 1. OCR language is `en-US`. Each view was recognized once in each of four configurations: `fast`/`accurate` recognition level crossed with language correction off/on. That is 24 recognition requests total. The Vision request revision was left at the OS default, so the engine revision is not pinned independently of macOS.

An initial 12-request pass was discarded after I corrected the two-column raster generator to match the fixture's left/right columns. It is excluded from every result below.

Apple describes `fast` as prioritizing speed and `accurate` as taking longer for more comprehensive recognition. It says language correction can improve accuracy, while disabling it can improve performance ([recognition level](https://developer.apple.com/documentation/vision/recognizetextrequest/recognitionlevel-swift.property), [language correction](https://developer.apple.com/documentation/vision/recognizetextrequest/useslanguagecorrection?changes=_1%2C_1)).

## Results

WER below is a **lexical-only, order-independent** word edit rate: lowercase alphanumeric tokens are sorted before edit distance is computed. This isolates recognition of the words from Vision's reading order. Timings cover only `VNImageRequestHandler.perform`; they exclude PNG decoding, process startup, image capture, and downstream context processing. Each row has six single-run samples; these are exploratory measurements, not stable latency estimates.

| Recognition | Language correction | Lexical WER | Median processing | Observed range |
|---|---:|---:|---:|---:|
| Fast | Off | 2.44% (3/123 words) | 13.4 ms | 11.7–29.3 ms |
| Fast | On | 2.44% (3/123 words) | 19.0 ms | 14.7–129.3 ms |
| Accurate | Off | 0% (0/123 words) | 67.0 ms | 63.3–217.4 ms |
| Accurate | On | 0% (0/123 words) | 89.5 ms | 76.1–320.7 ms |

The fast mode misrecognized one word in the clipped-card view and one token in the poster view; the third edit was a punctuation-derived token difference. Accurate mode recovered all 123 normalized words in these samples. Language correction did not change the lexical result on these six views and increased the observed median in both recognition modes. A fresh Swift process was launched for each configuration; the first request is included in the range and five subsequent requests shared that process. System/model cache state was not controlled, so these are neither labeled cold nor warm measurements.

Reading order remains a separate failure. The fast output placed the two columns row by row; the accurate output interleaved lines from both columns. Neither matched the fixture's left-column-first order. This experiment therefore does not support using raw Vision line order as extraction order. The lexical metric intentionally hides that failure.

## Limits

These are controlled synthetic browser images, not live screen captures or a representative user corpus. Only one image was measured for each scenario, and the timing samples are too small to set a product budget. The OCR-only phase measured no app upload path, permission flow, capture lifecycle, transcript assembly, or model call; a separate small model comparison is in `MODEL_COMPARISON.md`. This is native macOS-only evidence: a production integration would need a local native bridge/helper, its startup cost, and a policy for OS-dependent Vision revisions. No browser-worker OCR engine was measured. Gate B therefore remains inconclusive for browser OCR, and browser-worker approval stays open. This evidence does not decide product defaults or Gate C.

## Reproduce

From `frontend/` on macOS with Chrome and Xcode Command Line Tools installed:

```bash
bun scripts/observation-lab/capture-frames.ts representative /tmp/linkx-observation-ocr-inputs
swift scripts/observation-lab/VisionOCR.swift fast raw /tmp/linkx-observation-ocr-inputs/*.png
swift scripts/observation-lab/VisionOCR.swift fast corrected /tmp/linkx-observation-ocr-inputs/*.png
swift scripts/observation-lab/VisionOCR.swift accurate raw /tmp/linkx-observation-ocr-inputs/*.png
swift scripts/observation-lab/VisionOCR.swift accurate corrected /tmp/linkx-observation-ocr-inputs/*.png
```
