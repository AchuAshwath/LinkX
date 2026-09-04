# AGENTS.md - LinkX Development Guidelines

This repo is a FastAPI + React full-stack app. Below are repo-specific quirks and guardrails.

## Development Workflow (local frontend, local backend, Docker db/redis)

**Setup:** run **frontend on the host** with Bun/Vite, run **backend API locally on the host** with `uv`, and run **Postgres & Redis in Docker**.

```bash
# Terminal 1: Supporting Infrastructure (Postgres + Redis)
docker compose up -d db redis

# Terminal 2: Backend API (local host)
cd backend && uv run fastapi dev app/main.py --port 8000

# Terminal 3: Frontend (local host)
cd frontend && bun run dev
```

## Docker Commands (Infra Only)

```bash
docker compose up -d db redis        # Start DB & Redis in background
docker compose ps                     # Check DB & Redis health
docker compose logs db                # View Postgres logs
docker compose logs redis             # View Redis logs
docker compose down                   # Stop DB & Redis
```

## Lint & Typecheck

**Backend Python:** run lint, format, pytest, and Alembic locally on the host via `uv`:

```bash
# Backend lint (mypy + ruff check)
cd backend && uv run ruff check app tests
cd backend && uv run mypy app

# Backend format (auto-fix)
cd backend && uv run ruff format app tests

# Backend tests
cd backend && uv run pytest tests/ -v
```

**Frontend:** develop with **`bun` on the host**; lint and build the same way (matches local `bun run dev`).

```bash
cd frontend && bun run lint
cd frontend && bun run build
```

## Generate frontend API client (OpenAPI)

After backend API or schema changes, regenerate the typed client under `frontend/src/client`:

```bash
bash ./scripts/generate-client.sh
```

[`scripts/generate-client.sh`](scripts/generate-client.sh) generates `frontend/openapi.json` locally using `uv run`, runs `bun run --filter frontend generate-client`, and lints the output.

## Alembic Migrations

```bash
# Run migrations (local)
cd backend && uv run alembic upgrade head

# Create new migration
cd backend && uv run alembic revision --autogenerate -m "add field"
```

## Running Tests

API tests use a **per-test DB transaction**: [`backend/tests/conftest.py`](backend/tests/conftest.py) opens a connection-level transaction, binds a [`Session`](backend/tests/conftest.py) with `join_transaction_mode="create_savepoint"`, overrides [`get_db`](backend/app/api/deps.py) for `TestClient`, and **rolls back** after each test so commits inside routes do not leak across cases.

```bash
# Backend unit & integration tests
cd backend && uv run pytest tests/ -v
cd backend && uv run pytest tests/api/routes/test_users.py -v

# Frontend - E2E tests
cd frontend && bun run dev  # Start frontend first
cd frontend && bunx playwright test
```

## Complete Code Workflow (Before Committing)

Always follow this sequence:

```bash
# 1. Ensure DB and Redis are up in Docker
docker compose ps

# 2. Run backend linting & formatting locally
cd backend && uv run ruff check app tests
cd backend && uv run mypy app
cd backend && uv run ruff format app tests

# 3. Run frontend linting & build locally
cd frontend && bun run lint
cd frontend && bun run build

# 4. Run backend test suite
cd backend && uv run pytest tests/ -v

# 5. If you changed backend OpenAPI schemas, regenerate frontend SDK
bash ./scripts/generate-client.sh

# 6. Verify CodeScene Code Health Quality Gates (Local MCP or CLI)
# Run CodeScene delta analysis against master to catch complexity/degradation before pushing
python3 scripts/check_codescene.py  # or call cs-mcp analyze_change_set tool

# 7. Verify git status; commit only after explicit approval
git status
git add .
git commit -m "feat(scope): descriptive message"
```

## CodeScene MCP & Code Health Quality Gates

LinkX uses **CodeScene** for automated Code Health reviews on PRs. A PR check fails if any modified file degrades or introduces code health smells.

### CodeScene MCP Server
The local CodeScene MCP server binary (`/opt/homebrew/bin/cs-mcp`) is installed and configured in `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "codescene": {
      "command": "/opt/homebrew/bin/cs-mcp"
    }
  }
}
```

Key MCP tools provided by `cs-mcp`:
- `analyze_change_set`: Compares branch against base (`origin/master`) and verifies Code Health quality gates.
- `code_health_review`: Performs deep analysis on a single file with line numbers and refactoring suggestions.
- `code_health_score`: Retrieves current numeric score (1.0 - 10.0) for a file.
- `pre_commit_code_health_safeguard`: Analyzes staged changes before committing.

### Code Health Quality Standards (Must Follow)
To keep CodeScene CI checks green, all code must respect these thresholds:
1. **Low Cyclomatic Complexity**:
   - Backend functions: Cyclomatic complexity **<= 9** (module mean <= 4.0).
   - Frontend components/hooks: Cyclomatic complexity **<= 9** (components <= 10).
2. **Function Arguments**:
   - Maximum **<= 4 arguments** per function. Use keyword config/payload dicts or dataclasses/Pydantic models for larger parameter sets.
3. **Function Length**:
   - Maximum **<= 70 lines of code** per function. Break large methods into cohesive private helper functions.
4. **Nesting Depth**:
   - Maximum **< 4 levels** of nested blocks (`if`, `for`, `try`). Use early returns / guards.
5. **No Complex Conditionals**:
   - Avoid chaining multiple `&&` and `||` logic in single `if` statements (max 2 branches). Extract to descriptive boolean variables.
6. **No "Bumpy Road Ahead"**:
   - Avoid repeated deeply nested conditional blocks within a single function. Extract subroutines.


## AI Agents (Cursor, Copilot, etc.)

- **Do not** run `git commit` on your own. **Always confirm with the user** before committing (they must explicitly ask you to commit or approve the commit in the same turn).
- Prefer: finish edits → summarize changes → propose a commit message → **wait for confirmation** → then commit if asked.
- **Conventional Commits**: **Always** use Conventional Commits format for **both commit messages and PR titles** (`feat(...)`, `fix(...)`, `refactor(...)`, `test(...)`, `chore(...)`, `docs(...)`). Never use unstructured or generic commit/PR titles.

## Important Quirks & Guardrails

**DO**:
- Use `bun` on host for frontend
- Use `uv` on host for backend Python (`uv run ...`)
- Keep Docker limited strictly to `db` (Postgres) and `redis` services
- Use `.env` file for all config
- Use keyword-only args: `def foo(*, arg: Type)` in backend
- Use modern type hints: `X | None` (not `Optional[X]`), `list[X]` (not `List[X]`)
- Regenerate typed client after API changes via `bash ./scripts/generate-client.sh`

**DO NOT**:
- Run heavy backend containers in Docker unless explicitly testing full containerized builds
- Commit `.env` or any file with secrets/keys
- Use `Optional[X]` - use `X | None` instead
- Use `List[X]` - use `list[x]` instead
- Commit code without running the full workflow first
- **(Agents)** Commit without **explicit user confirmation** — never
- Use `List[X]` - use `list[x]` instead
- Commit code without running the full workflow first
- **(Agents)** Commit without **explicit user confirmation** — never

## Code Style (repo-specific)

- Backend: keyword-only args `def foo(*, arg: Type)`
- Frontend: double quotes, no trailing semicolons, `@/` alias for `src/`
- Model naming: `{Entity}Base`, `{Entity}Create`, `{Entity}Update`, `{Entity}Public`
- Git & PRs: **Conventional Commits** (`feat(scope): ...`, `fix(scope): ...`, `refactor(scope): ...`, `test(scope): ...`, `chore(scope): ...`, `docs(scope): ...`) across all commit messages and PR titles

## Services

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- Adminer (DB): http://localhost:8080
- Mailcatcher: http://localhost:1080
- Traefik: http://localhost:8090
