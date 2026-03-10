# Persona + Team Integration — Phase 2 Spec

## Summary
Phase 2 makes posts persona-first across API and UI. It enforces persona-based access for all post operations, requires persona_id in post requests, and updates the UI to operate within a persona context. Scheduling/publishing reliability changes are deferred to Phase 3.

## Goals
- Enforce persona-based access for all post reads and writes.
- Require explicit persona_id for post creation and listing.
- Update UI to select persona context and gate actions by role.

## Non-Goals
- Scheduling/publishing reliability changes (retry, error contract, state machine).
- New social platforms beyond LinkedIn.
- Multi-account per persona per platform.

## Roles and Permissions (Posts)
- Owner/Admin:
  - Create, edit, delete, and publish posts for the persona.
- Member:
  - Create and edit drafts only (no publish or schedule).

## API Contract (Phase 2)
### Posts
- GET /api/v1/posts?persona_id=...
  - persona_id is required; missing returns 400.
  - Returns posts for that persona only.
- POST /api/v1/posts
  - persona_id is required in body; missing returns 400.
  - Enforces persona access (owner/admin/member).
- PUT /api/v1/posts/{id}
  - Enforces persona access.
  - Member cannot change status to published.
- DELETE /api/v1/posts/{id}
  - Enforces persona access.
  - Member cannot delete posts if restricted by role (optional; enforce if needed).

### LinkedIn Publish Path
- Social account lookup is persona-scoped.
- Tokens are persona-scoped (from Phase 1).
- If no persona-linked SocialAccount exists, return a controlled error.

## Data Model and CRUD Alignment
- Add persona_id to PostCreate and PostUpdate (required).
- PostPublic includes persona_id and uses it for access.
- CRUD filtering uses persona_id instead of owner_id.
- owner_id remains legacy storage only; not used for access or filtering.

## UI/UX
- Persona selector in post list and post composer.
- Posts list filters by selected persona.
- Composer requires persona selection before submit.
- Role-based gating:
  - Owner/Admin: publish actions available.
  - Member: publish controls hidden/disabled.

## Migration and Compatibility
- No default persona fallback. Missing persona_id yields 400.
- Legacy clients must be updated to pass persona_id.
- Existing owner_id data remains for compatibility but unused for access.

## Error Handling
- 400 for missing persona_id on posts endpoints.
- 403 for insufficient role permissions.
- 404 for posts not found or not accessible under persona.

## Observability
- Log post actions with persona_id and user_id:
  - create/update/delete/publish attempts.

## Test Plan
- API tests:
  - GET /posts requires persona_id and filters correctly.
  - POST /posts rejects missing persona_id.
  - Role-based publish restrictions enforced.
- Unit tests:
  - Persona access resolution for posts queries and updates.
- UI tests:
  - Persona selection required for compose.
  - Role-based gating for publish controls.
  - Posts list filtered by persona.

## Acceptance Criteria
- Posts API and UI are persona-scoped.
- Missing persona_id is rejected with clear errors.
- Members cannot publish or schedule posts.
- Owner/Admin can publish posts when LinkedIn is connected for that persona.
