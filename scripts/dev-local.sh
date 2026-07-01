#!/usr/bin/env bash

# Auto-create .env.local if not present for host-native hybrid dev overrides
if [ ! -f .env.local ]; then
  echo "Creating default .env.local override file..."
  echo -e "POSTGRES_SERVER=localhost\nREDIS_URL=redis://localhost:6379/0" > .env.local
fi

# Auto-sync backend Python dependencies if virtualenv is missing
if [ ! -d backend/.venv ]; then
  echo "Backend virtual environment (.venv) not found. Bootstrapping with uv sync..."
  (cd backend && uv sync)
fi

# Auto-sync frontend packages if node_modules is missing
if [ ! -d frontend/node_modules ]; then
  echo "Frontend node_modules not found. Installing dependencies with bun install..."
  (cd frontend && bun install)
fi

# Start database & redis in Docker
echo "Starting Postgres and Redis in Docker..."
docker compose up -d db redis

# Run backend pre-start checks, migrations, and seeding, then launch fastapi dev
echo "Starting backend server..."
(
  cd backend
  uv run python app/backend_pre_start.py
  uv run alembic upgrade head
  uv run python app/initial_data.py
  uv run fastapi dev app/main.py
) &
BACKEND_PID=$!

# Launch frontend dev server
echo "Starting frontend server..."
bun run --filter frontend dev &
FRONTEND_PID=$!

# Trap SIGINT (Ctrl+C), SIGTERM, and EXIT to kill both background servers
trap 'echo "Stopping local development servers..."; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true' SIGINT SIGTERM EXIT

# Wait for both processes
wait
