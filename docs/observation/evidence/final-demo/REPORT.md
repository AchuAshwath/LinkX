# Integrated current-view demo — 19 October 2026

## Result

The final two-turn run passed through the real local React app, native Chrome browser-tab capture, authenticated FastAPI route, and configured `gpt-5.6-luna` vision provider. The app and proxy run locally; inference location and provider retention are not established by that fact. The browser selected a synthetic image-only notice; product code did not inspect its DOM or automate its input. The test harness advances the fictional fixture deliberately, so this is an automated integration check rather than a human-participant result.

The [criteria](criteria.json) were written before this final run. The first question contained neither code nor instruction; the answer identified `B7Q2M` and “Close the east shade at noon.” After the fixture changed, the second answer identified `R4X9K` and “Water the moon basil after sunset.” These are two known examples, not a general accuracy estimate.

The run produced exactly two chat POSTs, two usage events and no tool events. Each request had one image, zero historical images, and a distinct immutable revision (1 then 2). Transcript API readback contained neither image data URLs nor observation packets. Browser requests to external origins were blocked; none were attempted in the final run. This browser count does not measure backend provider egress. Restricted backend execution and the mocked route regressions provide separate evidence for tool/history isolation.

Keyboard actions opened capture, expanded usage details and activated Reset. Reset removed the preview and usage details; reload did not restore either. No crop, drag, or visual preview interaction was required to send the questions or read the ordinary HTML answers. No screen-reader speech/rotor or participant test was performed. A disposable demo account kept unrelated chat content out of the recording; its thread and account were deleted, and browser/context cleanup passed.

## Measurements

| Stage | First turn in fresh browser context | Second turn in same capture session |
| --- | ---: | ---: |
| Encode/prepare, delivered minus captured timestamp | 10 ms | 12 ms |
| Request to first text delta, browser fetch boundary | 3842.3 ms | 2739.9 ms |
| Stream completion, browser fetch boundary | 4247.1 ms | 3271.8 ms |
| Send click to completed response/assertion | 4330.1 ms | 3343.3 ms |
| Estimated input tokens | 146 | 155 |
| Input limit / output reserve | 12000 / 1200 | 12000 / 1200 |
| Encoded data URL characters | 68411 | 67267 |
| Image dimensions | 1440 × 912 | 1440 × 912 |

Capture setup took 230.8 ms. Both encode samples met the prospective <250 ms warm-prepare hypothesis, but two samples do not establish a p95 or performance guarantee. "Fresh" and "warm" refer only to browser context/session reuse; OS, model and upstream caches were not controlled. Upload and provider-only latency cannot be separated here and remain unavailable. Token values are application estimates from LiteLLM, not provider-reported billing or exact usage.

## Artifacts

- [Raw synthetic-only result metadata and answers](results.json)
- [Two-window recording: source on left, app on right](two-window-demo.webm)
- [Lab walkthrough recording](lab-walkthrough.webm)
- [Approved minimal preview and collapsed disclosure](app.png)
- [Expanded usage details](details.png)
- [Synthetic source](source.png)

The usage wording was subsequently clarified to distinguish LinkX screenshot history from provider retention; this copy-only change is not reflected in the recorded frame.

## Reproduce

Start Docker db/redis and the host backend/frontend as described in [the demo guide](../../current-view-demo.md). With Playwright's ffmpeg dependency installed, run from `frontend/`:

```bash
bunx playwright install ffmpeg
OBSERVATION_DEMO_URL=http://127.0.0.1:4001 OBSERVATION_API_URL=http://127.0.0.1:8001 bun scripts/observation-demo/run.mjs
```

The runner authenticates using the ignored local settings without printing credentials, creates an isolated account/thread, records the synthetic source and app, makes two real configured-model requests, verifies metadata/transcript/keyboard behavior, then deletes its account/thread. It writes results, screenshots and per-tab video under `/tmp/linkx-observation-final-demo` by default. Set `OBSERVATION_DEMO_OUTPUT` to preserve a different run. Set `OBSERVATION_DEMO_HEADED=1` for a visible isolated Chrome window. Never use real/private platform material as this fixture.

To compose the two recordings side by side, use ffmpeg's `hstack` filter; the checked-in clip is scaled to 960 pixels per window to keep the artifact small. The source fixture and scripts are repository-owned fictional material under the repository MIT license.

## Failed attempts and limits

An initial recording setup lacked Playwright's ffmpeg dependency and did not send a model request. A subsequent test configuration combined Chrome's fake-media UI switch with source selection and captured the app itself; its one model response correctly said the intended notice was unreadable. That harness attempt is excluded from the two-turn success result. The runner now uses title-specific tab selection and verifies a bright synthetic notice before sending. A corrected two-turn trial passed; the final clean-account two-turn run above also passed. In total, five model requests were made during these integration attempts, with no automatic retry loop. The cleanup scope was independently tested against an unavailable API: it failed authentication, wrote an empty cleanup-failure list, and left no Playwright-owned Chrome process.

The results do not establish general accessibility outcomes, cross-browser support, general OCR/model accuracy, local-only inference, provider retention, or a platform/legal classification. Automatic history, OCR readback and recent-view comparisons remain explicitly deferred in the [decision record](../../experiment-decision-2026-10-19.md).
