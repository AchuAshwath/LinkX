# Current-view observation (local demo)

## Start the worktree

This worktree shares the local Postgres/Redis services. Start them with:

```bash
docker compose up -d db redis
```

In one terminal, start the worktree API on port 8001. Port 8000 is already used on this machine by a server from another checkout:

```bash
cd backend
POSTGRES_SERVER=localhost REDIS_HOST=localhost SCHEDULER_ENABLED=false uv run fastapi dev app/main.py --port 8001
```

In a second terminal, start Vite on port 4001 and point its API proxy to this worktree:

```bash
cd frontend
VITE_API_URL=http://127.0.0.1:8001 bun run dev -- --host 127.0.0.1 --port 4001
```

Open [http://127.0.0.1:4001/ai](http://127.0.0.1:4001/ai) and sign in with the local account configured for this worktree. The local OpenAI-compatible vision proxy must be available through the settings in `.env`; keep credentials in the ignored `.env.local` file.

## Use it

1. Open the **+** menu in the composer, choose **Browser tab**, and select a browser tab in the browser share prompt. The capture requests video only and verifies that the browser reports a browser surface.
2. A compact floating preview appears in the open sidebar space below **Create Post** and above the profile. Drag the window or focus it and use the arrow keys to reposition it. The **X** in the preview stops sharing. A muted or not-yet-presented frame stays in a waiting state, and Send is blocked until a live frame arrives after capture resumes.
3. Ask a question in the composer. The app synchronously captures the current preview when Send is pressed, then freezes that JPEG packet into the queued turn. It does not reuse a prior frame after queue delay.
4. Current-view questions use the configured vision model. The ordinary chat model picker does not change this fixed observation model.
5. Selecting an unrelated chat also stops the capture. A new-chat send keeps it only for the thread created by that send.
6. Expand **Browser context details** to inspect estimated input usage, limit/output reserve, the submitted revision and dimensions, and the one-frame/zero-history coverage. **Reset browser context** disconnects capture and clears these details. Reloading or changing chats also expires local source context; previous answers remain ordinary text. The panel starts collapsed to preserve the minimal composer/preview.

The image encoder bounds the longest edge to 2048 pixels, the image to 4,194,304 pixels, and the JPEG data URL to 2,000,000 characters. Requests reject ordinary image attachments while observation is active; the composer keeps its prompt and attachments so the user can resolve the conflict. The backend validates and decodes the JPEG, allows one image, and calls the configured vision model directly without browser tools, retrieval, previous screenshots, or fallback models.

Input counting uses LiteLLM model metadata and its multimodal token counter as an estimate. The application input cap is 12,000 estimated tokens, with 1,200 output tokens reserved separately. Unknown capability or counting metadata fails closed. The local proxy does not report token capacity, and the provider's exact image-token usage is not available in the stream, so do not treat this estimate as provider-reported usage.

Send submits the current frame to the configured vision model through the configured proxy. The frame is request-scoped in LinkX: the LinkX transcript keeps the question and text response, not the screenshot, packet, or data URL. Do not paste packet values into logs or issue reports.

## Local API-route smoke

An earlier authenticated route smoke on 2026-10-18 sent a synthetic 640×360 JPEG containing “Status: Ready” to this worktree's `POST /api/v1/ai/threads/{id}/chat` route with `gpt-5.6-luna`. The route returned HTTP 200 and the SSE stream contained “Ready”; transcript readback contained the question and no frame data URL. The temporary thread was deleted. The request estimated 144 input tokens under the 12,000-token cap and reserved 1,200 output tokens. The exact question was not preserved in the smoke record, so this result does not prove that the answer came from the image pixels.

## Image-only visual grounding check

One authenticated route request used the exact question `Read the uppercase code printed in this image. Return only the code.` The expected code `3ZB9U3J` appeared only in the generated synthetic JPEG. The configured observation model `gpt-5.6-luna` returned `3ZB9U3J` exactly (HTTP 200; eight SSE events; 316 response bytes; approximately 3.8 seconds). The transcript contained the question and answer but zero image URLs/base64 payloads; the temporary thread was deleted successfully. One POST was sent, with no retry or other model inference request. The local result metadata and image hash are in [live-grounding-v1](evidence/live-grounding-v1/REPORT.md), alongside the [exact question](evidence/live-grounding-v1/question.txt), [result metadata](evidence/live-grounding-v1/result.json), [synthetic image](evidence/live-grounding-v1/fixture.jpg), and [file hashes](evidence/live-grounding-v1/SHA256SUMS.txt). This demonstrates one controlled synthetic example only; it does not establish general accuracy, provider retention behavior, or on-device inference.

## Measurement and scope decisions

- **Gate A, live capture policy:** exercised with a real Chrome `getDisplayMedia()` track on a synthetic local tab. The v1 32×32 tiled candidate caught scripted text changes, but v2 showed that exact whole-frame settling starved under continuous indicator motion. Settling changed tiles caught the text changes, then emitted a duplicate frame from a temporarily stable animation tile. The simple policy is not safe as a general default. Both reports, raw results, accepted samples, and harnesses are in [live-capture-v1](../../frontend/scripts/observation-lab/live-capture-v1/REPORT.md) and [live-capture-v2](../../frontend/scripts/observation-lab/live-capture-v2/REPORT.md). The separate Canvas prototype is [capture-policy-canvas-v1.md](evidence/capture-policy-canvas-v1.md). No interval or novelty threshold is enabled in the product; every Send captures a fresh current frame.
- **Gate B, OCR:** not approved for the product. Browser Tesseract's six-fixture check had 24.4% ordered word error, missed poster text, and misordered columns; its report is [browser-tesseract-v1.md](evidence/browser-tesseract-v1.md). macOS Vision and model comparisons are retained under [frontend/scripts/observation-lab](../../frontend/scripts/observation-lab/), with their limitations in each report. OCR and historical-view context are not on the production request path.
- **Accessibility fixture:** the separate [local task page](../../frontend/accessibility-v1-demo.html) uses a fictional PNG whose text is not included in its accessible name. The task, ground truth, manual Chrome checks, and limits are in [accessibility-fixture-task-v1.md](evidence/accessibility-fixture-task-v1.md). This was one developer-run desktop check, not participant research or a VoiceOver test.
- **Gate C, vision model:** one image-only route grounding check is recorded above. It confirms one synthetic pixel-only code against the configured model. This single example does not establish general accuracy, provider location, or production quality. Use the exact fixed model displayed by the app for future comparisons.

## Checks

The frontend unit suite passed (31 files, 253 tests), with typecheck, lint, and production build passing. Focused observation session, controls, and packet checks passed (24 tests). The public composer regression verifies muted and waiting Sends preserve the prompt and do not create a thread, then proceed after a frame arrives. The full backend suite passed (825 tests in 202.40 seconds), including the 30-turn public-route regression with the provider mocked. Ruff, format check, and mypy passed. The full CodeScene change-set review passed: 43 eligible files checked across 76 modified paths, with zero issues. Request-content validation is in `backend/app/api/ai_chat_content.py`; route authentication, ownership lookup, persistence, and dispatch remain in `ai_threads.py`.

## Final implementation and research decisions

The [19 October decision record](experiment-decision-2026-10-19.md) selects current-view-on-Send and explicitly defers automatic accepted-view history (#159), product OCR readback (#160), and recent-view comparisons (#161). These optional branches are not claimed as implemented. The standalone lab now shows actual preserved native OCR lines beside fixture images/ground truth, with session-only corrections and skip controls; its export excludes this source content. The fresh [native OCR rerun](evidence/native-ocr-final-2026-10-19/REPORT.md) failed its ordered-text gate because of column order.

The [final integrated run](evidence/final-demo/REPORT.md) records two successful real-provider questions, keyboard details/reset/reload, cold/warm browser-session timings, an isolated-account two-window clip, and a lab walkthrough. It distinguishes measured application behavior from missing provider-only timings, participant evidence, and contractual interpretation. These prospective final-run criteria do not retroactively preregister older exploratory experiments.
