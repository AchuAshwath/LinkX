# Local vision model comparison

## Request setup

I ran six matched image questions through the existing local OpenAI-compatible proxy at `127.0.0.1:8317`, using model `gpt-5.6-luna`, temperature 0, and a 120-token output cap. The response identified the same model on all 12 requests. The proxy and app run locally; the upstream inference provider and execution location were not instrumented, so these results are not evidence of on-device model inference.

For each of six synthetic fixture views, I made two independent calls with the same question:

- **Direct image:** the model receives the 1280×900 PNG and question.
- **OCR text:** the model receives only text extracted from that PNG by the native macOS Vision `accurate`, `en-US`, language-correction-on configuration described in `OCR_EVIDENCE.md`.

That is 12 comparison calls. A separate direct-image smoke check was made before the matched run, so 13 model requests were sent in total. All returned HTTP 200. I did not send other model requests.

## Results

| Fixture view | Direct image | OCR text | Expected fact |
|---|---|---|---|
| Scrolling feed | Correct | Correct | North entrance |
| 200% zoom | Correct | Correct | Twelve nearby blocks |
| 400% zoom | Correct | Correct | 2024 |
| Two columns | Correct | Correct | School groups |
| Clipped card | Correct | Correct | West pier |
| Poster text | Correct | Correct | Saturday, 10 am to 2 pm |

Both paths recovered the expected fact in all six examples. One answer omitted “nearby blocks” while preserving the requested quantity; punctuation and capitalization differences were treated as equivalent. This is a six-question capability check, not an accuracy estimate for general use.

| Path | Correct | Median time | Mean time | Range | Median prompt tokens |
|---|---:|---:|---:|---:|---:|
| Direct image request | 6/6 | 1.69 s | 1.74 s | 1.36–2.02 s | 1,732 |
| OCR text model request only | 6/6 | 1.35 s | 1.46 s | 1.29–1.73 s | 367 |
| OCR text + matched native Vision processing | 6/6 | 1.44 s | 1.59 s | 1.39–2.05 s | 367 |

Model response times are one request per fixture per path, measured from the local client through the proxy until the full response arrived. They include proxy/provider latency; no cold/warm state, concurrency, or upstream timing was controlled. The OCR-text calls used precomputed OCR text, so their model-request times exclude OCR. The third row adds each fixture's separately measured native Vision `perform` time to its matched OCR-text model response; it excludes Swift process startup and capture and is a cross-run estimate, not a single end-to-end execution. The app's OCR cache-at-Send behavior was not measured. The two-column OCR output was not in fixture reading order, though this question still had a correct answer.

## Recent-view coverage check

I used three two-view questions to test historical coverage: the earlier-only park detail in a scrolling feed, the earlier-only workshop sentence at 200% before a 400% view, and Likes counters changing from 14/22 to 15/23. Each case received three calls: both screenshots (earlier then current), the current screenshot plus OCR text explicitly labeled as earlier, and the current screenshot alone. That used nine additional calls. The current-only prompt instructed the model to say unavailable when the question required earlier information.

| Input path | Historical answers correct | Current-only abstention correct | Median response | Mean response | Range | Median prompt tokens |
|---|---:|---:|---:|---:|---:|---:|
| Earlier + current screenshots | 3/3 | — | 2.03 s | 2.14 s | 1.64–2.75 s | 3,136 |
| Current screenshot + earlier OCR | 3/3 | — | 2.67 s | 2.64 s | 2.28–2.98 s | 1,785 |
| Current screenshot only | — | 3/3 | 2.43 s | 2.80 s | 1.47–4.51 s | 1,740 |

The current-image-plus-prior-OCR calls used already extracted text. Adding the matched native Vision processing time for the earlier frame gives a separate summed median of 2.74 s, mean 2.73 s, and range 2.37–3.08 s. This excludes capture and Swift process startup. With OCR already cached at send time, the model-request row is the relevant number; with uncached prior OCR, the summed estimate is closer. Neither path was faster consistently in this three-task sample, and upstream timing noise is large relative to the sample.

Both historical input paths answered all three earlier-view questions, while the current-only path correctly disclosed that those past details were unavailable. That supports the expected coverage distinction on these fixtures only. It does not test a product's OCR-to-view association or provenance enforcement: earlier text was labeled in the prompt by the harness.

## Limits and decision

The sample uses original fictional text on clean browser-rendered views. It does not cover live capture, noisy or adversarial screens, unclear answers, long context, privacy controls, or integration into the chat request path. The upstream provider is not established by the local proxy URL. These results support only that the tested input forms answered these nine known questions; they do not settle a production architecture or choose sampling, context, or OCR defaults.

Gate C has a local-proxy smoke, six matched current-view questions, and three matched recent-view coverage tasks (22 model requests total including the initial smoke). Treat provider quality and latency as inconclusive pending a larger, representative corpus and explicit upstream/provider characterization. Gate B remains inconclusive for browser-worker OCR because the OCR engine tested here is macOS Vision.

To recreate the six history screenshots and local OCR text from `frontend/` on macOS:

```bash
bun scripts/observation-lab/capture-frames.ts history /tmp/linkx-observation-history
swift scripts/observation-lab/VisionOCR.swift accurate corrected /tmp/linkx-observation-history/*.png
```
