#!/usr/bin/env bash

# Dump OpenAPI from the backend running in Docker, then regenerate the frontend client.
# Requires: Docker backend service up (`docker compose watch backend` or equivalent), repo-root `bun`.

set -e
set -x

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Optional escape hatch for rare offline commits.
if [ "${SKIP_GENERATE_CLIENT:-0}" = "1" ]; then
  echo "SKIP_GENERATE_CLIENT=1 set; skipping OpenAPI client generation." >&2
  exit 0
fi

BACKEND_ID="$(docker compose ps -q backend 2>/dev/null || true)"
if [ -z "$BACKEND_ID" ]; then
  cat >&2 <<'EOF'
Backend container is not running.

Start the API (from repo root) and re-run:
  docker compose watch backend

Then re-run:
  bash ./scripts/generate-client.sh
EOF
  exit 1
fi

# Fail fast with an actionable message if the container isn't reachable/healthy.
if ! docker compose exec -T backend bash -lc 'true' >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Backend container exists but could not be reached/executed.

Check:
  docker compose ps backend
  docker compose logs backend

Then re-run:
  bash ./scripts/generate-client.sh
EOF
  exit 1
fi

docker compose exec -T backend bash -lc \
  'cd /app/backend && uv run python -c "import app.main; import json; print(json.dumps(app.main.app.openapi()))"' \
  > frontend/openapi.json
bun run --filter frontend generate-client
bun run lint
