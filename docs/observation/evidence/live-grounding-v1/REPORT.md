# Live app-route visual grounding check (v1)

## Result

One authenticated `POST /api/v1/ai/threads/{id}/chat` observation request returned the exact uppercase code visible in a generated synthetic JPEG. The code existed only as pixels in the model request; it was not present in the prompt or request metadata.

- Exact question: `Read the uppercase code printed in this image. Return only the code.`
- Image-only expected code: `3ZB9U3J`
- Model answer: `3ZB9U3J` — exact match.
- Configured observation model: `openai/gpt-5.6-luna` (effective ID `gpt-5.6-luna`).
- HTTP 200; `text/event-stream; charset=utf-8`; 8 SSE events (7 `text_delta`, then `done`); response body 316 bytes; about 3.8 seconds.
- Synthetic JPEG: 960×320, SHA-256 `9b8b9b5c5120f853094e7133715536d328e1afeae32c07954676f9ff9f83a2f4`.

## Transcript and title behavior

Authenticated transcript readback contained the exact question and answer, zero `data:image` URLs, and no base64 image payload. The one test thread was deleted successfully (DELETE 200). Observation turns return early from `_save_assistant_turn` before its automatic title-generation call. That path was checked in source; model-call count was not separately instrumented. No automatic title model call was made by the observation request path.

This verifies one synthetic visual-grounding example and LinkX transcript exclusion for that request. It does not establish general visual accuracy, provider retention/deletion behavior, or on-device inference.

## Request boundaries

- One observation chat POST was issued. No retry and no other model inference request was made.
- The request question contained no expected code. The `observation` packet fields contained only UUID/revision/timestamps/dimensions and the JPEG data URL; no expected code, fixture filename, or code-valued metadata was sent.
- Authentication used the configured local account loaded in process memory. Credentials and the image data URL are excluded from this bundle.
- Temporary backend: worktree `b6a7/LinkX`, local port 8001, started with host `localhost` Postgres/Redis overrides and `SCHEDULER_ENABLED=false`. The process started for this check was stopped. The existing port-8000 service was left untouched.
- Source worktree was not edited. The request ran against the requested frozen-08 worktree state (snapshot SHA `655c4173d67d3b479353a4bfab168ca553b669f2587b3a7be2347b5e979a8c6e`); its underlying Git HEAD was `0914522f94aaf26cf2080d4845fd77fa3aeb4b6d` with the already-present uncommitted snapshot files.

## Artifacts

- `run_check.py`: reproducible one-request harness. It generates a new random code per execution; do not rerun this artifact when preserving the one-call cap.
- `fixture.jpg`: exact image sent.
- `question.txt`, `ground_truth.txt`: exact prompt and local expected code.
- `result.json`: exact prompt, expected code, response, HTTP/SSE metadata, transcript checks, and cleanup result. It deliberately excludes the data URL and credentials.
- `SHA256SUMS`: checksums for the saved evidence files (not a self-hash).
