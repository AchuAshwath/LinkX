# Browser reading: research synthesis and proposed next experiment

Date: 2026-10-20. Research and design only; no runtime change, model call, or claim of validated capture coverage.

The recommendation is a conservative, serial viewport pipeline with optional overlap registration. Keep every admitted viewport independently interpretable; use estimated overlap to reduce repeated work only after measuring false suppression. A giant stitched page, aggressive perceptual hash, or model-emitted magic word would each hide an important failure mode.

## Source-backed precedents

| Precedent | Implemented or researched pattern | Transfer limit |
| --- | --- | --- |
| [ShareX source at 10a74d5](https://github.com/ShareX/ShareX/blob/10a74d50a29229a31b5a68e61acf8130403edba2/ShareX.ScreenCaptureLib/ScrollingCaptureManager.cs#L255-L380) | Searches scanline overlap, appends new rows, and marks a reused alignment fallback partially successful. | It drives desktop scrolling. Its stitcher is not a proven passive-browser tracker, and general sticky-region detection remains an [open proposal](https://github.com/ShareX/ShareX/issues/8631). |
| [screenpipe source at 315ac4a](https://github.com/screenpipe/screenpipe/blob/315ac4a99ef47729a820eab333dda8ca32e6fbe5/crates/screenpipe-screen/src/frame_comparison.rs) | Point-sampled thumbnails, hash fast path, histogram comparison, optional SSIM. | These reduce work but do not establish tiny-glyph recall. Its OS/UI event triggers are unavailable to our passive shared-tab page. |
| [OpenCV motion analysis](https://docs.opencv.org/4.13.0/d7/df3/group__imgproc__motion.html) | Phase correlation estimates relative translation and returns a response measure. | Response is not a calibrated probability. Repeated text, multiple moving regions, missing overlap, and layout changes require rejection tests. |
| [Public full-page capture extension source at d1b6bbb](https://github.com/mrcoles/full-page-screen-capture-chrome-extension/blob/d1b6bbbf4c3f8101d787dd737e5476a5be082014/page.js) | Injected code reads scroll position, viewport/document dimensions, and device pixel ratio, then scrolls and requests captures sequentially. | This is historical public source; the repository says the current store implementation is private. Its page instrumentation and automatic scrolling change our current access model. |
| [Self-RAG](https://arxiv.org/abs/2310.11511), [CRAG](https://arxiv.org/abs/2401.15884) | Explicit evidence-quality decisions and corrective control branches. | Self-RAG trains reflection tokens. Prompting a general model with a special word does not reproduce that result. CRAG's retrieval/search machinery is unnecessary for our screenshot queue. |

The [screen-capture specification](https://w3c.github.io/mediacapture-screen-share/#constrainable-properties) defines video dimensions, frame rate, surface type, and related capture settings. It does not give the capturing application the source page's scrollY or document height. Relative displacement inferred from pixels must remain labeled as an estimate. A cooperative source or extension can supply page metrics; it is a separate option, not an existing stream capability.

## Proposed minimum experiment

1. **Verify delivery and preserve detail.** Record media frame/callback counters, received dimensions, and lossless before/after samples. Retain a small local frame buffer. Thumbnail comparison may estimate motion cheaply, but a persistent localized change at higher resolution must have its own admission path. The previous successful 44→45 trial is one useful case, not proof of universal sensitivity.
2. **Estimate overlap conservatively.** Prototype one vertical translation matcher, verified against several separated content bands. Do not introduce phase correlation, ECC, and feature matching all at once. Treat disagreement as uncertain; stationary furniture may be excluded from alignment only when supported across frames. Never erase it from the source evidence.
3. **Classify the observation.** Distinguish unchanged revisit, newly revealed region, changed content in an aligned region, and unaligned new view. A digit change is a revision even when most pixels match. Zoom, reflow, ambiguous repeated paragraphs, or no overlap starts a new segment; preserve the standalone viewport and uncertainty rather than guessing continuity. Geometry alone cannot prove document identity or navigation.
4. **Reduce redundancy without removing the only evidence.** Initially retain full viewport input plus overlap metadata. Test novel-strip inputs with surrounding context separately before replacing full inputs. Reuse an interpretation only for confidently unchanged content. Deduplicate exact repeated transcript blocks while preserving changed values, negation, and chronology. An [existing screenpipe issue](https://github.com/screenpipe/screenpipe/issues/2285) illustrates redundant OCR context; its proposed fix is not evidence of an implemented solution.
5. **Keep sequential interpretation and bounded volatile memory.** One interpretation at a time; recent original frames/anchors, compact observation notes, and rolling summaries remain session-local. Specify byte, age, and count bounds. Queue replacement or failure must create explicit missing-coverage records. Do not silently adopt latest-wins as a substitute for the user's wish to remember browsing.

No passive sampler can recover a section that never appeared in a delivered readable frame. A finite queue also cannot retain an indefinitely faster input stream without either processing capacity, an increasing backlog, or explicit loss. Slow operation is acceptable here; invisible loss is not. We should measure the tradeoff before choosing retention limits.

## Question hook

Keep transcription and question evaluation separate responsibilities, using the selected model sequentially. On Send, freeze the admitted capture cutoff and pause unsent ordinary work. A dedicated evaluator emits a validated answer/wait/insufficient envelope with internal evidence sequence IDs. The runtime checks ownership, generation, cutoff, and stale responses. A wait resumes the next relevant eligible job, then re-evaluates after its completion; it does not require draining the entire queue. A deadline or exhausted evidence terminates honestly.

Internal IDs establish which ready notes were referenced, not whether a claim follows from them. Wrong-subject, absent-fact, contradictory-value, and instruction-in-screenshot cases need labeled answer checks. A small explicit state machine is sufficient; a new agent framework and parallel generations are not proposed.

## Acceptance evidence before integration

Build adjacent-frame ground truth using controlled long documents and replay the three real articles from the existing trials. Include repeated paragraphs, sticky header/sidebar, animation beside text, lazy-loaded images, tight/slow/fling scrolling, reversal, zoom, and single-character updates. Keep source-page scroll telemetry confined to the test harness as ground truth; the pixel-only algorithm must not consume it.

Measure false overlap joins, false duplicate suppression, useful-link rate, small-change recall, visible-content coverage, queue age/bytes, and CPU time. A matcher that rejects every pair has low false joins but no utility, so report both. Predeclare pass thresholds before the comparison; existing public algorithms do not establish suitable thresholds for LinkX.

Start with capture/registration offline. Only after that gate passes should we repeat sequential model trials and adversarial wait-hook tests. Keep the existing candidate as the baseline for comparison. This research does not justify declaring the feature complete or replacing its runtime yet.

## Detailed research notes

- [Current GitHub implementations](./robust-capture-github-patterns-2026-10-20.md)
- [Registration algorithms and limits](./robust-screen-registration-research-2026-10-20.md)
- [Wait-hook research and runtime contract](./robust-browser-wait-hook-patterns-2026-10-20.md)
