# AGENTS.md - LinkX Development Guidelines

This repo is a FastAPI + React full-stack app. Below are repo-specific quirks and guardrails.

## Development Workflow (Docker Only)

```bash
# Terminal 1: Frontend
cd frontend && bun run dev

# Terminal 2: Backend (Docker)
docker compose up -d backend
```

## Docker Commands

```bash
docker compose up -d                  # Start all services
docker compose up -d backend          # Backend only
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
# Backend - inside container
docker compose exec backend pytest tests/api/routes/test_users.py -v
docker compose exec backend pytest tests/api/routes/test_users.py::test_name -v

# Frontend - E2E tests
cd frontend && bun run dev  # Start frontend first
docker compose run --rm playwright bunx playwright test tests/login.spec.ts
```

## Complete Code Workflow (Before Committing)

Always follow this sequence:

```bash
# 1. Verify backend is running
docker compose ps backend

# 2. Run linting (mypy + ruff check)
docker compose exec backend bash scripts/lint.sh

# 3. Run formatting (auto-fix code style)
docker compose exec backend bash scripts/format.sh

# 4. Run full test suite
docker compose exec backend pytest tests/ -v

# 5. Copy code back to local (if ruff made changes)
docker cp linkx-backend-1:/app/backend/app/. ./backend/app/

# 6. Verify git status and commit
git status
git add .
git commit -m "descriptive message"
```

## Important Quirks & Guardrails

**DO**:
- Use `bun` for frontend
- Run `bun run generate-client` in frontend after backend API changes
- Use `.env` file for all config - auto-loaded by docker
- Check logs when debugging: `docker compose logs backend`
- Run full workflow before commits: lint → format → test → copy-back → commit
- Use keyword-only args: `def foo(*, arg: Type)` in backend
- Use modern type hints: `X | None` (not `Optional[X]`), `list[X]` (not `List[X]`)
- Copy tests directory to Docker if not present: `docker cp ./backend/tests <container>:/app/backend/`

**DO NOT**:
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
