# Browser-reading system smoke

Last refreshed on 6 November 2026 after the pending-capture close cases and
their expected-failure control completed.

The controlled Chrome run passes 25 checks against the real local API, database,
browser capture/session, question runner, final agent, SSE stream, and transcript
storage. The readiness provider returns only `read_next`, `ready`, or
`insufficient`; it never supplies answer text. Final prose comes from the normal
agent through a scripted OpenAI-compatible ChatOpenAI transport backed by
`httpx.MockTransport`, so the run makes no paid/live model calls.

The smoke asserts at least two actual `text_delta` events and checks that their
joined text matches the visible and persisted answer. It also inspects the
ordinary ChatOpenAI request and confirms it contains the original question and
the prepared browser note. The complete check list and passing result are in
[system-smoke-result.json](system-smoke-result.json).

## Run it

Keep the normal app on ports 4000/8000. Start the dedicated test API and frontend
on 8001/4001:

```bash
cd backend
READING_SMOKE_BASE=http://127.0.0.1:4001 \
READING_SMOKE_API_PORT=8001 \
LITELLM_LOG=ERROR \
uv run --no-sync python -m scripts.observation_lab.reading_system_server
```

```bash
cd frontend
VITE_API_URL=http://127.0.0.1:8001 \
bun run dev --host 127.0.0.1 --port 4001 --strictPort
```

```bash
cd frontend
READING_SMOKE_BASE=http://127.0.0.1:4001 \
bun scripts/observation-lab/browser-reading-system.mjs
```

Run [pending-capture-close](pending-capture-close/README.md) separately, using
the same isolated ports after stopping the system-smoke server. Both scripts
remove their temporary users and threads. The system harness waits for its
scripted background image reads to settle before exiting. The Nov 6 run used
the commands above in this order and stopped only its own servers afterward.
