# Sharing closes while only the second pending image contains the answer

Verified on 6 November 2026 with the final browser-assisted streaming
implementation. The smoke runs on isolated test ports and uses scripted local
providers.

## Result

The real Chrome app accepted two pending images at Send. The warm-up note and
first image contain no access code; only the second image contains SAPPHIRE-742.
The test holds image 1's provider response until after sharing closes, so image 2
cannot have been read before closure.

| Action while `1 of 2 images` is visible | Observed result |
| --- | --- |
| Close the floating preview | Preview/memory clear; image 2 is read; correct answer appears and is saved once |
| End the shared source track | Same outcome; no cancellation request for the submitted question |
| Press chat Stop generating | Request settles as cancelled; image 2 is not read; no answer is generated or saved |

For both sharing-close paths, the test also checks `2 of 2 images` after closure,
no early answer while image 2 is blocked, ordered note receipts, both completed
frame IDs, no failed/unused IDs, and no screenshots or raw reading notes in saved
history. Late notes do not repopulate the cleared session memory.

The readiness trace is: warm-up read → `read_next` → image 1 read → `read_next` →
image 2 read → `ready`. Readiness emits no answer text. The ordinary agent then
uses a scripted external ChatOpenAI transport and emits at least two SSE
`text_delta` chunks; their joined answer is exactly `The access code is
SAPPHIRE-742.` Closing happens while image 1 is held. For explicit chat Stop the
trace ends after image 1 and never reaches another readiness call or image 2.

- [Passing result and operation traces](result.json)
- [Preview before closure: 1 of 2](preview-before-close.png)
- [Preview after closure: 2 of 2](preview-after-close.png)
- [Source before closure: 1 of 2](source-before-close.png)
- [Source after closure: 2 of 2](source-after-close.png)

## Regression control

The `--regression-control` run deliberately adds the dispatched question back to
the capture shutdown settlement list. Playwright rewrites the module response for
that test browser only; source files and the normal app are unchanged.

The run exits 1 with the expected assertion:

```text
Closing sharing must not cancel the dispatched question before image 2
```

[Recorded expected failure](regression-control.json). This proves the test detects
the cancellation regression rather than merely checking that any answer exists.
Normal behavior was tested again afterward and all three cases passed.

## Reproduce

Run these from the repository worktree, keeping the normal app on 4000/8000.

```bash
# Terminal 1: backend test app on 8001, scheduler disabled
cd backend
uv run --no-sync python -m scripts.observation_lab.pending_capture_server
```

```bash
# Terminal 2: frontend test app on 4001
cd frontend
VITE_API_URL=http://127.0.0.1:8001 bun run dev --host 127.0.0.1 --port 4001 --strictPort
```

```bash
# Terminal 3: actual regression, then optional expected-failure control
cd frontend
bun scripts/observation-lab/pending-capture-close.mjs
bun scripts/observation-lab/pending-capture-close.mjs --regression-control
```

Chrome, the normal Docker db/redis, and the local admin credentials in `.env` /
`.env.local` are required. The test creates and removes its own temporary user and
threads. The control endpoints exist only in the separately launched test server.
The final-answer transport uses `httpx.MockTransport`; no paid/live answer
provider is called.

## Scope and manual trigger

Capture uses a synthetic canvas MediaStream through the real video sampler,
capture admission, session, chat UI, HTTP/SSE, broker, question runner, provider
schema validation, and transcript persistence. The scripted provider distinguishes
the actual JPEGs by a colored fixture marker; this is not OCR or live-model
accuracy evidence, nor certification of a physical Chrome sharing dialog.

The progress indicator counts the question's accepted pending-image batch. If
background reading has caught up before Send, there may be no image progress. A
narrow question can also finish from ready notes without reading pending images.
For a manual attempt, change between distinct readable views while a background
read is still busy, then submit before that queue drains. The test's barriers make
that timing reliable instead of depending on capture/model speed.

Image 2 must already have been captured and included in the submitted request.
Closing sharing preserves that frozen request; it cannot capture a new view after
sharing ends.

On 6 November, Playwright captured a clone of the actual browser-chat SSE body as
it streamed, then checked the same event names and joined text. This keeps the
test's stream assertions intact through the long image barriers.

The run order was the three-case smoke, the expected-failure regression control,
then the 25-check system smoke. The exact commands are listed above; both test
servers used ports 8001/4001 while the normal app remained on 8000/4000.
