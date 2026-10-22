# Capture v3 review candidate — 2026-10-21

The user completed the random-page manual test on 2026-10-22 and reported that it worked well, then approved committing and merging the capture-only candidate. The seven runtime files still match the tested SHA-256 manifest. This change packages that candidate independently on `codex/browser-capture-v3`, with the lab at <http://127.0.0.1:4000/browser-context-lab.html>. It validates screenshot admission and relative alignment in the tested cases. Background transcription, browser memory, and question hooks remain separate implementation stages; the overall feature and decision gate #173 remain open.

The 93-test evidence below came from the combined research workspace. This standalone change includes the 53 v3 capture tests; the other 40 scheduling/memory/earlier capture tests belong to separate, unmerged prototypes. Those prototype implementations and their backend experiments are intentionally outside this change. The lab's link to the unmerged memory experiment was removed; the tested capture runtime is unchanged. The manifest records the pre-commit candidate's provenance.

Packaging checks on 2026-10-22 passed: the isolated 53 capture tests, full frontend lint/build, backend Ruff/mypy/format checks and 828 backend tests, plus the isolated CodeScene gate on 17 eligible files. Backend app/test sources are unchanged from the common baseline; their checks ran in the research checkout with the existing local environment. Pytest exited successfully with 24 existing warnings and a post-summary LiteLLM cleanup logging error. The isolated lint check has no warnings, only the existing Biome schema-version informational notice. Large raw JSON records are losslessly minified for review; evidence values are unchanged.

## What changed

- The stream supplies full received RGBA pixels and native dimensions. Repeated media delivery does not trigger repeated encoding, and oversized or invalid sources produce explicit diagnostics.
- Settled changes retain small edits, including a digit, letter, or negation. Independent animation and fixed page furniture do not have to stop for readable content to qualify.
- A bounded coherent-motion probe admits readable intermediate views during continuous vertical scrolling. It runs at most once per configured interval, defaults to one second, and releases its anchors after each probe.
- High-DPI features prioritize native source rows through 4096px and adapt feature width to the byte budget. This fixes fractional-row pooling and odd-displacement failures without reducing the captured image resolution.
- Thin-text displacement search is finer at the tested native feature heights. Moving support combines feature evidence and the fraction of matching horizontal zones using a geometric mean. This is an explicit policy change: a dense fixed table of contents can no longer outweigh matching article text solely by containing more contrast pixels. Detailed mismatch, vertical-band, and ambiguity checks remain in place.
- Uncertain alignment retains the independent full viewport. Exact repeated pixels report visual equality with unknown position. Neither result establishes absolute scroll depth.
- Stop clears images, pending work, pixel buffers, and anchors. Recent previews have count, encoded-byte, and decoded-pixel limits; the lab is not an image archive. Diagnostics contain metadata rather than screenshots.

Luna implemented the registration corrections and independently reviewed admission, retention, lifecycle, and the final motion-support rule. The audit found the odd-height and fixed-TOC failures before handoff; their regression tests now pass. See [AUDIT.md](AUDIT.md).

## Verification

| Check | Final result |
| --- | --- |
| Public-interface tests | 93/93: 53 v3 capture tests and 40 earlier prototype regressions |
| Browser UI lifecycle | 8/8, including late picker completion, mute/end, Stop, and image-dialog release |
| Controlled rendered matrix | 291 offers, 76 candidates; all 48 section markers captured during the slow full-page traverse |
| Tiny text changes | 3/3 captured: digit, single letter, negation |
| Controlled geometry | 0 confident joins across disjoint views; 42/66 eligible overlap links correct within 8px |
| Continuous rendered replay | 13 intermediate coherent captures over 2340 CSS pixels; 100% measured viewport-interval coverage |
| Frontend build and full Biome check | Pass; existing build warnings, 3 lint warnings and informational notices remain |
| CodeScene safeguard | Pass, all 58 eligible files |

The controlled matrix includes slow, tight, fast, reverse, pause, animated, reflow, zoom, and full-traverse cases. It records source DOM geometry only as independent test truth; the pipeline receives pixels and frame metadata. Its offer-handling p95 was **57.8ms at 1280×900**. Full-traverse candidate intervals covered 97.0% of document height with the sticky header excluded. The correct-link rate is 63.6%; rejected geometry remains independent image evidence rather than being described as a successful join.

Final headed Chrome runs exercised actual `getDisplayMedia` delivery at **2880×1550**, with source/video agreement checked first. Each continuous run scrolled 2400 CSS pixels without intentional reading pauses:

| Source | Intermediate coherent captures | Largest observed source travel without a capture | Offer p95 |
| --- | ---: | ---: | ---: |
| Controlled long page | 9 | 280px | 176ms |
| [web.dev article](https://web.dev/articles/rendering-on-the-web) | 5 | 700px | 188ms |
| [Chrome browser article](https://developer.chrome.com/blog/inside-browser-part3) | 9 | 260px | 200ms |
| [Simon Willison article](https://simonwillison.net/2025/Mar/11/using-llms-for-code/) | 9 | 260px | 209ms |

The source viewport was 775 CSS pixels high. The native gate requires at least four coherent captures and no sampled travel exceeding one viewport without a capture. The web.dev case passed twice consecutively after the fix; its other run retained seven coherent views. All final native runs had zero page errors and released retained pixels and anchors on Stop. These progress checks do not measure exact semantic coverage. Native pipeline timings exclude video readback; final public-article readback-plus-offer p95 was 220–234ms. The 100ms provisional replay gate applies to the smaller rendered fixture, not these native measurements.

The [raw evidence directory](raw/) includes compact source/decision records, both pre-fix failures, native results, lifecycle results, the unit-test log, CodeScene output, and a SHA-256 runtime manifest. The final controlled record is [validation-headless-2026-10-21.json](raw/validation-headless-2026-10-21.json). Native files use the `native-continuous-` prefix. See [PROTOCOL.md](PROTOCOL.md) for reproducible commands and scoring.

## Practical limits

Fast jumps can cross sections that never reach a delivered frame. Pixel-only capture cannot recover them or infer reliable absolute page position. Contrast quality is a heuristic, not an OCR or semantic-readability guarantee. Repeated layouts can remain ambiguous. A portrait 4K fixture under the 256 KiB probe budget deliberately rejects uncertain alignment; above 4096 rows, grouping can also miss small shifts. Continuous capture is therefore not guaranteed across every layout or resolution.

Capture work still runs on the UI thread. The measured native cost is acceptable for this slow research trial, but occasional long tasks remain possible. No model concurrency or generation API refactor was introduced. This lab makes no model requests and does not validate transcription, summaries, or answer quality.

## Manual test and next step

1. Open a long article in another Chrome tab. In the capture lab, choose **Share a browser tab** and select that article.
2. Read with continuous slow scrolling, tiny scrolls, reversals, and a fast fling followed by a pause. Return to inspect the counter and recent images; images should be sharp and show changing views. Only a bounded recent subset is retained for inspection.
3. Change zoom or navigate within the shared tab. Confirm subsequent captures reflect the new view; uncertain alignment may be shown independently.
4. Stop sharing using Chrome or the lab. Confirm images clear, then restart and check that old session images do not return.

If captures stall while the source visibly changes, export diagnostics before stopping. The export excludes screenshot payloads. The manual gate and commit approval completed on 2026-10-22. This merge accepts the capture experiment; it does not promote the incomplete combined feature. Before product integration, close the remaining model-quality, queue/backpressure, semantic-memory and question-grounding decisions in #173, then implement #159, #168, #171 and #161 and audit the complete path in #172.
