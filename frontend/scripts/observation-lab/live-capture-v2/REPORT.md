# Live tab capture: continuous-animation settle check (v2)

## Question and result

Does exact whole-frame stability starve on a live tab when an irrelevant indicator keeps moving, and can settling only changed tiles avoid that without inventing false updates?

The exact whole-frame 150 ms rule starved in all three stages: it accepted nothing during 2.2 s of indicator-only motion, 2.2 s with a one-digit update, or 2.2 s with a later text addition. A single changed-tile workaround (same 32 px / 8% novelty rule and 150 ms stability requirement, applied per tile against the last accepted frame) detected the digit at 713 ms and the text addition at 710 ms. It also accepted a second JPEG at 1,913 ms during the digit stage even though no new text had changed. That extra candidate settled in tile 236, where the moving indicator travels. The update tile was 289. Thus tile-local settling removes initial starvation but still mistakes a temporarily stable animation region for another change. It cannot determine semantic importance from pixels alone.

The workaround made no accept during the 2.24 s indicator-only stage. That bounded observation does not establish no false positives for longer or other animations. It did produce one animation-driven duplicate after the meaningful digit update, so this simple fix is not safe as a general live-frame policy. The latest user-directed capture should remain authoritative for answering; this result does not support replacing it with an automatic settled-frame history.

## Method

A single isolated, headed Chrome tab rendered a fictional reading page and captured itself through `getDisplayMedia({video:{displaySurface:"browser"},audio:false})`. The indicator moved on an 80 ms timer. The test sampled `drawImage(video)` at a target 200 ms interval and ran both policies on each same frame: (1) exact full-frame pixel stability for 150 ms, and (2) candidate tiles with >=8% changed pixels, accepting the full latest frame if any changed tile remained pixel-identical across samples for 150 ms. Pixel changes use max RGB channel delta >=24. The tile policy advances its comparison baseline to the accepted full frame.

Chrome 155.0.8059.82 reported `displaySurface: browser`, 1280×702, and 30 fps; `requestVideoFrameCallback` ran 224 times, median interval 33.3 ms (range 14.8–64.9 ms). Actual detector sample intervals had a 234 ms median. Automated setup was 126 ms using Chrome fake UI plus automatic selection of this synthetic tab; that excludes ordinary picker and consent time. At JPEG quality .82, the expected digit frame was 23,436 bytes and the animation-driven duplicate was 23,444 bytes; the text-addition frame was 26,636 bytes. No OCR, semantic model, or network request was used.

## Reproduction and limits

`results.json` is the raw frame-by-frame run; `metrics.json` derives per-stage sample intervals and acceptance delays. The accepted JPEGs show the exact video-derived frames. Run the scratch `server.mjs`, then `run-overlap.mjs` with the installed LinkX Playwright package and Chrome. Set `LIVE_CAPTURE_OUTPUT` and `LIVE_CAPTURE_PROFILE` to new paths to preserve this run when repeating it.

This is one synthetic page on one Mac/Chrome build. Fake UI bypasses normal picker selection, and the track crops 18 px from the 1280×720 canvas. The test isolates the timing/novelty issue only; it does not establish semantic importance, performance on real feeds, or a production settling policy.
