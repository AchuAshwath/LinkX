# AGENTS.md - LinkX Development Guidelines

This repo is a FastAPI + React full-stack app. Below are repo-specific quirks and guardrails.

## Development Workflow (Docker Only)

**Every day:** keep the backend running under **Compose watch** so your local `./backend` tree stays synced into the container while you work (save files on the host; the running API sees updates without rebuilds or `docker cp`).

```bash
# Terminal 1: Frontend (local)
cd frontend && bun run dev

# Terminal 2: Backend — always use watch for local development (leave this running)
docker compose watch backend
```

`docker-compose.override.yml` maps **`./backend` → `/app/backend`**, including **`app/`**, **`tests/`**, Alembic, and scripts. Leave this process running for your whole session.

**Do not** use `docker compose up -d backend` as your default way to run the backend while coding: it does **not** enable file watch, so the container can drift from your working tree until you rebuild or copy files manually. Reserve detached `up -d` for automation, CI, or rare cases where you intentionally want a static container.

## Docker Commands

```bash
# Daily backend dev (sync on save — use this)
docker compose watch backend

docker compose up -d                  # Start stack without watch (not for everyday editing)
docker compose up -d backend          # Backend only, no watch (not for everyday editing)
docker compose logs backend           # View backend logs
docker compose logs -f backend        # Follow logs
docker compose restart backend        # Restart backend
docker compose exec backend <command> # Run command in container
```

## Lint & Typecheck (Run in Docker)

```bash
# Backend lint (mypy + ruff)
docker compose exec backend bash scripts/lint.sh

# Backend format (auto-fix)
docker compose exec backend bash scripts/format.sh

# Backend tests
docker compose exec backend pytest tests/ -v

# Frontend lint
docker compose exec frontend bun run lint

# Frontend build
docker compose exec frontend bun run build
```

## Alembic Migrations

```bash
# Verify container is up
docker compose ps backend

# Run migrations
docker compose exec backend alembic upgrade head

# Create new migration
docker compose exec backend alembic revision --autogenerate -m "add field"
```

## Running Tests

```bash
# Backend - inside container (with docker compose watch backend running so app + tests are synced)
docker compose exec backend pytest tests/api/routes/test_users.py -v
docker compose exec backend pytest tests/api/routes/test_users.py::test_name -v

# Frontend - E2E tests
cd frontend && bun run dev  # Start frontend first
docker compose run --rm playwright bunx playwright test tests/login.spec.ts
```

## Complete Code Workflow (Before Committing)

Always follow this sequence (with **`docker compose watch backend`** already running from your dev session, or start it first so lint/tests run against synced code):

```bash
# 1. Verify backend is running (watch keeps ./backend synced)
docker compose ps backend

# 2. Run linting (mypy + ruff check)
docker compose exec backend bash scripts/lint.sh

# 3. Run formatting (auto-fix code style)
docker compose exec backend bash scripts/format.sh

# 4. Run full test suite
docker compose exec backend pytest tests/ -v

# 5. Copy code back to local (if ruff/format ran in the container and changed files)
docker cp linkx-backend-1:/app/backend/app/. ./backend/app/
# (With docker compose watch, you usually edit on the host; copy-back is only needed when tools wrote into the container.)

# 6. Verify git status and commit
git status
git add .
git commit -m "descriptive message"
```

## Important Quirks & Guardrails

**DO**:
- Use `bun` for frontend
- **Always run `docker compose watch backend` while working on the backend** so `./backend` stays synced to the container every day; do not rely on `docker compose up -d backend` for active development
- Run `bun run generate-client` in frontend after backend API changes
- Use `.env` file for all config - auto-loaded by docker
- Check logs when debugging: `docker compose logs backend`
- Run full workflow before commits: lint → format → test → copy-back → commit
- Use keyword-only args: `def foo(*, arg: Type)` in backend
- Use modern type hints: `X | None` (not `Optional[X]`), `list[X]` (not `List[X]`)
- Avoid manual `docker cp` for app or test files while watch is running. Only use `docker cp` in exceptional cases (e.g. a one-off container with no watch and no rebuild option)

**DO NOT**:
- Use `docker compose up -d backend` as your habitual backend workflow when editing code—use **`docker compose watch backend`** instead
- Commit `.env` or any file with secrets/keys
- Run `docker compose up --build` in CI - use pre-built images
- Modify `compose.yml` for local changes - use `.env` or `compose.override.yml`
- Use `Optional[X]` - use `X | None` instead
- Use `List[X]` - use `list[x]` instead
- Commit code without running the full workflow first

## Code Style (repo-specific)

- Backend: keyword-only args `def foo(*, arg: Type)`
- Frontend: double quotes, no trailing semicolons, `@/` alias for `src/`
- Model naming: `{Entity}Base`, `{Entity}Create`, `{Entity}Update`, `{Entity}Public`

## Services

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- Adminer (DB): http://localhost:8080
- Mailcatcher: http://localhost:1080
- Traefik: http://localhost:8090
