# AGENTS.md - Coding Agent Guidelines

This document provides instructions for AI coding agents working in this repository.
The project is a full-stack FastAPI + React application with Python backend and TypeScript frontend.

## Project Structure

```
backend/          # Python FastAPI application
  app/            # Main application code (models, api, core, crud)
  tests/          # Pytest tests
  scripts/        # Shell scripts for lint/test/format
frontend/         # React TypeScript application (Vite + TanStack Router)
  src/            # Source code (components, hooks, routes, client)
  tests/          # Playwright E2E tests
```

## Build/Lint/Test Commands

### Backend (Python)

```bash
cd backend

bash scripts/test.sh                                    # Run all tests with coverage
pytest tests/api/routes/test_users.py -v                # Single test file
pytest tests/api/routes/test_users.py::test_get_users_superuser_me -v  # Single test
pytest tests/ -k "test_create_user" -v                  # Tests matching pattern

bash scripts/lint.sh                                    # Lint (mypy + ruff)
bash scripts/format.sh                                  # Auto-fix and format
fastapi dev app/main.py                                 # Dev server
```

### Frontend (TypeScript/React)

```bash
cd frontend

npm run dev                                             # Dev server
npm run build                                           # Production build
npm run lint                                            # Lint with auto-fix
npm run generate-client                                 # Generate API client

npx playwright test                                     # All E2E tests
npx playwright test tests/login.spec.ts                 # Single test file
npx playwright test -g "Log in with valid email"        # Test by name
npx playwright test --headed                            # Visible browser
```

### Docker Compose

```bash
docker compose watch                                    # Start stack with hot reload
docker compose logs backend                             # View logs
```

## Code Style Guidelines

### Backend (Python)

**Formatting**: Ruff (Python 3.10+). **Type Hints**: mypy strict mode.

**Import Order** (3 groups separated by blank lines):
1. Standard library
2. Third-party (`fastapi`, `sqlmodel`, `pydantic`)
3. Local (`from app...`, `from tests...`)

**Type Hints** - Use modern syntax:
```python
def get_user(*, session: Session, email: str) -> User | None:  # not Optional[User]
list[str]  # not List[str]
SessionDep = Annotated[Session, Depends(get_db)]  # Annotated for dependencies
```

**Naming**:
- Functions/variables: `snake_case`
- Classes: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Models: `{Entity}Base`, `{Entity}Create`, `{Entity}Update`, `{Entity}Public`

**Function Parameters**: Use keyword-only with `*`:
```python
def create_user(*, session: Session, user_create: UserCreate) -> User:
```

**Error Handling**:
```python
if not user:
    raise HTTPException(status_code=404, detail="User not found")
```

**Testing**: pytest fixtures, names like `test_{action}_{subject}_{condition}`

### Frontend (TypeScript/React)

**Formatting**: Biome (double quotes, spaces, no trailing semicolons)

**Import Order** (enforced by Biome):
1. External libraries (alphabetically)
2. Internal with `@/` alias (alphabetically)
3. Relative imports

**Path Alias**: `@/` maps to `src/`:
```typescript
import { Button } from "@/components/ui/button"
import type { UserPublic } from "@/client"  // type-only imports
```

**Type Patterns**:
```typescript
const formSchema = z.object({ email: z.email(), password: z.string().min(8) })
type FormData = z.infer<typeof formSchema>
```

**Component Style**:
```typescript
const AddUser = () => {
  // 1. Hooks first
  // 2. Mutations/queries
  // 3. Handlers
  // 4. Render
}
export default AddUser
```

**Naming**:
- Components: `PascalCase` (files: `PascalCase.tsx`)
- Hooks: `use` prefix (files: `useAuth.ts`)
- Routes: `kebab-case.tsx`
- Test files: `kebab-case.spec.ts`
- data-testid: `kebab-case`

**Error Handling**:
```typescript
const mutation = useMutation({
  mutationFn: (data) => UsersService.createUser({ requestBody: data }),
  onError: handleError.bind(showErrorToast),
})
```

## Pre-commit Hooks

```bash
cd backend && uv run prek install -f    # Install hooks
uv run prek run --all-files             # Run manually
```

## Key Technologies

**Backend**: FastAPI, SQLModel, Pydantic, Alembic, PostgreSQL, uv
**Frontend**: React, Vite, TanStack Router/Query, Tailwind, shadcn/ui, Zod, Playwright
**Infrastructure**: Docker Compose, Traefik, Mailcatcher (dev)

## Development URLs

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- Adminer (DB): http://localhost:8080
- Mailcatcher: http://localhost:1080
