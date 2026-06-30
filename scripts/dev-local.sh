#!/usr/bin/env bash

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
