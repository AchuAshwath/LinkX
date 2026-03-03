# AGENTS.md

This document provides guidelines for agentic coding agents working in the LinkX frontend project.

## Build/Lint/Test Commands

```bash
# Install dependencies (uses bun)
bun install

# Start development server
bun run dev

# Build for production
bun run build

# Preview production build
bun run preview

# Lint and format code
bun run lint

# Generate API client from OpenAPI spec
bun run generate-client
```

### Running Playwright Tests

```bash
# Run all tests
bunx playwright test

# Run tests in UI mode
bunx playwright test --ui

# Run a specific test file
bunx playwright test tests/login.spec.ts

# Run tests matching a pattern
bunx playwright test --grep "login"

# Run tests in a specific project
bunx playwright test --project=chromium

# Run with trace for debugging
bunx playwright test --trace=on
```

### Type Checking

```bash
# Run TypeScript compiler
bunx tsc --noEmit
```

## Code Style Guidelines

### TypeScript
- Use TypeScript with `strict: true` enabled
- No `any` types unless explicitly allowed in biome.json
- Use interfaces for object types, `type` for unions/primitives
- Enable `noUnusedLocals` and `noUnusedParameters`

### Biome Linting
- Biome is configured for linting and formatting
- Run `bun run lint` to auto-fix issues
- Configuration in `biome.json`:
  - Auto-organize imports enabled
  - `noNonNullAssertion`: off
  - `noArrayIndexKey`: off
  - `noParameterAssign`: error
  - `useSelfClosingElements`: error
  - `noUselessElse`: error
  - Quote style: double
  - Semicolons: as-needed

### Imports
- Use absolute imports with `@/` alias (e.g., `@/components/Button`)
- Import order: React → external libraries → internal components → utils → CSS
- Group imports logically

### Naming Conventions
- Components: PascalCase (e.g., `Sidebar`, `PostPreview`)
- Hooks: camelCase with `use` prefix (e.g., `useAuth`, `useMobile`)
- Files: PascalCase for components, camelCase for utilities/hooks
- Variables/functions: camelCase
- Constants: UPPER_SNAKE_CASE for config values
- CSS classes: kebab-case (Tailwind)

### Component Structure
```typescript
// 1. Imports
import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"

// 2. Types
interface MyComponentProps {
  title: string
  onClick?: () => void
}

// 3. Component (prefer function components)
export function MyComponent({ title, onClick }: MyComponentProps) {
  // State
  const [count, setCount] = useState(0)

  // Event handleClick = () handlers
  const => {
    setCount((c) => c + 1)
    onClick?.()
  }

  // Render
  return (
    <div>
      <h1>{title}</h1>
      <Button onClick={handleClick}>Count: {count}</Button>
    </div>
  )
}
```

### Styling
- Use Tailwind CSS v4 for styling
- Use `cn()` utility from `@/lib/utils` for class merging
- Use CVA (class-variance-authority) for component variants
- Example: button.tsx uses `buttonVariants` cva pattern

### Error Handling
- Use `react-error-boundary` for component-level error boundaries
- Use try/catch for async operations
- Return fallback UI on errors
- Log errors with context using console.error

### API Patterns
- Use TanStack Query for data fetching
- Generated client in `src/client` from OpenAPI spec
- Regenerate with `bun run generate-client` when backend changes

### File Organization
```
src/
  ├── components/
  │   ├── Common/         # Shared components
  │   ├── UI/             # Shadcn/ui components
  │   ├── Feature/        # Feature-specific components
  │   └── ...
  ├── routes/             # TanStack Router pages
  ├── hooks/              # Custom hooks
  ├── lib/                # Utilities (utils.ts, db.ts)
  ├── client/             # Generated API client
  └── main.tsx            # Entry point
```

### TanStack Router
- Routes defined in `src/routes/` with file-based routing
- Auto-generated route tree at `src/routeTree.gen.ts`
- Layout routes use `_layout` prefix (e.g., `src/routes/_layout/`)

### Testing
- Playwright E2E tests in `tests/` directory
- Auth setup in `tests/auth.setup.ts` (uses storageState)
- Test files: `*.spec.ts` pattern
- Configuration in `playwright.config.ts`

## Project Configuration

- **Build Tool**: Vite
- **Linter**: Biome
- **Testing**: Playwright
- **Routing**: TanStack Router
- **State**: TanStack Query
- **Styling**: Tailwind CSS v4
- **Package Manager**: bun
- **Node Version**: See `.nvmrc`
- **Path Alias**: `@/` → `src/`
- **API Client**: Generated from OpenAPI spec

## Creating Remotion Videos

To create videos showcasing this website:
1. Set up a separate Remotion project
2. Use screenshots or live captures of the frontend
3. Capture key flows: login, post creation, timeline, settings
4. Use `@remotion/player` to embed compositions in demos
5. Render with `npx remotion render`
