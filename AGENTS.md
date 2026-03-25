# AGENTS.md - LinkX Development Guidelines

This repo is a FastAPI + React full-stack app. Below are repo-specific quirks and guardrails.

## Development Workflow (frontend local, backend Docker)

**Typical setup:** run the **frontend on the host** with Bun/Vite, and run the **API only inside Docker** (no local Python/uv for the backend day to day).

```bash
# Terminal 1: Frontend (local — recommended)
cd frontend && bun run dev

# Terminal 2: Backend API — Docker only; use watch so ./backend stays synced into the container
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

## Lint & Typecheck

**Backend Python:** run lint, format, pytest, and Alembic **inside the backend container** — do **not** use a local `uv run`, `python`, or `pytest` on the host for backend checks (avoids env drift and matches how the API runs).

```bash
# Backend lint (mypy + ruff)
docker compose exec backend bash scripts/lint.sh

# Backend format (auto-fix)
docker compose exec backend bash scripts/format.sh

# Backend tests (container WORKDIR is /app/backend)
docker compose exec backend pytest tests/ -v
```

**Frontend:** develop with **`bun` on the host**; lint and build the same way (matches local `bun run dev`).

```bash
cd frontend && bun run lint
cd frontend && bun run build
```

If you run the **frontend** service in Compose, you can alternatively use `docker compose exec frontend bun run lint` / `bun run build`, but that is optional.

## Generate frontend API client (OpenAPI)

After backend API or schema changes, regenerate the typed client under `frontend/src/client`.

- **`frontend/openapi.json`** is the input for `@hey-api/openapi-ts` (see [`frontend/openapi-ts.config.ts`](frontend/openapi-ts.config.ts)). Codegen does **not** fetch `http://localhost:8000/...`; it reads that file on disk.
- **Backend must be running in Docker** (`docker compose ps backend` healthy). From the **repo root**:

```bash
bash ./scripts/generate-client.sh
```

[`scripts/generate-client.sh`](scripts/generate-client.sh) runs `docker compose exec` to dump the OpenAPI JSON from the container app into `frontend/openapi.json`, runs `bun run --filter frontend generate-client`, then `bun run lint` on the host.

**Git hooks:** this repo uses [**prek**](https://prek.j178.dev/) with [`.pre-commit-config.yaml`](.pre-commit-config.yaml) (see [`development.md`](development.md)). Install once from `backend`: `uv run prek install -f`. To run the same checks as the hook **without committing**, from `backend` run:

```bash
uv run prek run --all-files
```

Changing files under `backend/` or `scripts/generate-client.sh` runs the **Generate Frontend SDK** hook. That runs [`scripts/generate-client.sh`](scripts/generate-client.sh), so **Docker backend must be up** and **`bun`** available on the host.

Without Docker (e.g. offline API): copy or download a spec into `frontend/openapi.json`, then `cd frontend && bun run generate-client` (see [`frontend/README.md`](frontend/README.md)).

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

API tests use a **per-test DB transaction**: [`backend/tests/conftest.py`](backend/tests/conftest.py) opens a connection-level transaction, binds a [`Session`](backend/tests/conftest.py) with `join_transaction_mode="create_savepoint"`, overrides [`get_db`](backend/app/api/deps.py) for `TestClient`, and **rolls back** after each test so commits inside routes do not leak across cases. Session-wide setup (e.g. superuser) still runs once via `init_db`.

Optional session teardown: exporting `LINKX_PYTEST_CLEANUP_EPHEMERAL_USERS=1` before `pytest` runs a **destructive** cleanup that deletes every user outside the superuser + seeded TODO email allowlist (see `conftest.py`). Use only on a throwaway DB you are sure is safe.

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

# 4b. If you changed backend OpenAPI, regenerate the frontend client (Docker backend must be running)
bash ./scripts/generate-client.sh

# 5. Copy code back to local (if ruff/format ran in the container and changed files)
docker cp linkx-backend-1:/app/backend/app/. ./backend/app/
# (With docker compose watch, you usually edit on the host; copy-back is only needed when tools wrote into the container.)

# 6. (Optional) Run git hook checks locally — from `backend`: `uv run prek run --all-files`

# 7. Verify git status; commit only after explicit approval (see AI Agents below)
git status
git add .
git commit -m "descriptive message"
```

## AI Agents (Cursor, Copilot, etc.)

- **Do not** run `git commit` on your own. **Always confirm with the user** before committing (they must explicitly ask you to commit or approve the commit in the same turn).
- Prefer: finish edits → summarize changes → propose a commit message → **wait for confirmation** → then commit if asked.

## Important Quirks & Guardrails

**DO**:
- Use `bun` for frontend
- **Always run `docker compose watch backend` while working on the backend** so `./backend` stays synced to the container every day; do not rely on `docker compose up -d backend` for active development
- Run **backend** lint, format, pytest, and Alembic **via `docker compose exec backend …`** only — not `uv run` / local `pytest` on the host
- After backend API changes, run **`bash ./scripts/generate-client.sh`** from the repo root with **Docker backend up** (or rely on prek’s SDK hook under the same conditions) so `frontend/openapi.json` and `frontend/src/client` stay in sync
- Use `.env` file for all config - auto-loaded by docker
- Check logs when debugging: `docker compose logs backend`
- Run full workflow before commits: lint → format → test → copy-back → commit
- Use keyword-only args: `def foo(*, arg: Type)` in backend
- Use modern type hints: `X | None` (not `Optional[X]`), `list[X]` (not `List[X]`)
- Avoid manual `docker cp` for app or test files while watch is running. Only use `docker cp` in exceptional cases (e.g. a one-off container with no watch and no rebuild option)

**DO NOT**:
- Use `docker compose up -d backend` as your habitual backend workflow when editing code—use **`docker compose watch backend`** instead
- Use a **local** Python/uv environment for backend checks (`uv run pytest`, `python -m pytest`, etc.)—use **Docker** as above
- Commit `.env` or any file with secrets/keys
- Run `docker compose up --build` in CI - use pre-built images
- Modify `compose.yml` for local changes - use `.env` or `compose.override.yml`
- Use `Optional[X]` - use `X | None` instead
- Use `List[X]` - use `list[x]` instead
- Commit code without running the full workflow first
- **(Agents)** Commit without **explicit user confirmation** — never

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
