#! /usr/bin/env bash

# Dump OpenAPI from the backend running in Docker, then regenerate the frontend client.
# Requires: Docker backend service up (`docker compose watch backend` or equivalent), repo-root `bun`.

set -e
set -x

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

docker compose exec -T backend bash -lc \
  'cd /app/backend && uv run python -c "import app.main; import json; print(json.dumps(app.main.app.openapi()))"' \
  > openapi.json

cp openapi.json frontend/openapi.json
bun run --filter frontend generate-client
bun run lint
