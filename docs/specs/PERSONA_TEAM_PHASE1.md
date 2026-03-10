# Persona + Team Integration — Phase 1 Spec

## Summary
Phase 1 delivers persona-first identity and collaboration foundations without changing the post ownership model. The scope is:
- Persona CRUD
- Team CRUD + membership
- Persona sharing to teams with role-based access
- Persona-scoped LinkedIn OAuth and token storage
- Minimal UI flow to create/select persona and connect LinkedIn

Posts remain user-owned in Phase 1; persona-based post creation, scheduling, and reliability improvements are deferred to later phases.

## Goals
- Make personas a first-class, explicit identity for social connections.
- Enable team-based sharing of personas with clear role permissions.
- Scope LinkedIn OAuth tokens to persona to prevent cross-persona collisions.
- Provide minimal UI to create/select a persona and connect LinkedIn.

## Non-Goals
- Persona-based post creation and filtering.
- Scheduling/publishing reliability changes (retry, error contract, etc.).
- Direct user-level persona grants (team-only access in Phase 1).
- Multi-account per persona per platform.

## Definitions
- Persona: Content identity owned by a user.
- Team: Group of users for collaboration.
- Persona Access: A grant that shares a persona with a team plus role.
- Roles: owner, admin, member.

## Roles and Permissions
- Owner:
  - Full persona control: edit/delete persona, share/unshare, manage social accounts.
- Admin:
  - Read persona data and manage social connections for the persona.
- Member:
  - Read-only access to persona and related social account status.

Rules:
- Persona owner is always the creator user.
- Persona access is granted to teams only (no direct user grants in Phase 1).
- Effective role = highest role across all teams the user belongs to for that persona.

## Data Model Changes
### New Table: persona_access
Fields:
- id (UUID PK)
- persona_id (FK persona.id, required)
- team_id (FK team.id, required)
- role (string enum: owner|admin|member)
- granted_by_user_id (FK user.id, required)
- created_at, updated_at

Constraints:
- Unique (persona_id, team_id)
- Index on persona_id and team_id

### Existing Tables
- social_account: enforce unique (persona_id, platform)
- team_membership: enforce unique (team_id, user_id)

## API Surface (Phase 1)
### Personas
- GET /api/v1/personas
  - Returns personas owned by the user + personas shared with teams they belong to.
- POST /api/v1/personas
  - Creates a persona owned by the user.
- GET /api/v1/personas/{id}
  - Requires access (owner or via team share).
- PUT /api/v1/personas/{id}
  - Owner only.
- DELETE /api/v1/personas/{id}
  - Owner only.

### Persona Sharing
- POST /api/v1/personas/{id}/share
  - Body: {team_id, role}
  - Owner only.
- GET /api/v1/personas/{id}/access
  - Owner only.
- DELETE /api/v1/personas/{id}/access/{team_id}
  - Owner only.

### Teams
- GET /api/v1/teams
  - Teams where the user is a member.
- POST /api/v1/teams
  - Creates a team with current user as owner.
- POST /api/v1/teams/{id}/members
  - Body: {user_id, role}
  - Owner/admin only.
- DELETE /api/v1/teams/{id}/members/{user_id}
  - Owner/admin only. Owner cannot remove the last owner.

### LinkedIn (Persona-scoped)
- GET /api/v1/linkedin/status?persona_id=...
  - Returns connection status for that persona.
- OAuth callback
  - Persona_id must be supplied via OAuth state.
  - SocialAccount is created/updated for the persona.
  - Tokens stored under persona scope.

## OAuth and Token Scoping
- OAuth state must include persona_id and CSRF token.
- Tokens stored under Redis key: linkedin:token:{persona_id}.
- SocialAccount is linked to persona_id; user_id is retained for legacy visibility.
- If persona_id is missing or invalid in OAuth state, callback returns 400.

## UI/UX (Minimal)
- Persona creation flow is required before LinkedIn connect.
- Persona selector is shown on the LinkedIn connection screen.
- Connect LinkedIn triggers OAuth with persona_id in state.
- Role-based UI gating for persona settings:
  - Owner: can share/unshare persona.
  - Admin: can connect/disconnect LinkedIn for that persona.
  - Member: view-only.

## Migration and Compatibility
- Existing personas already backfilled; no new data migration required in Phase 1 beyond persona_access table.
- Existing LinkedIn connections are user-scoped; users must reconnect per persona to attach tokens.
- Posts remain user-owned; no changes to post routes or filters in Phase 1.

## Error Handling
- Consistent 403 for insufficient permissions.
- Consistent 404 when resource is not found or not accessible.
- OAuth callback returns 400 for missing/invalid persona_id state.

## Observability
- Log OAuth success/failure with persona_id, user_id, and trace_id.
- Log persona share/unshare actions with persona_id, team_id, and user_id.

## Test Plan
- Unit tests:
  - Persona access resolution (owner/admin/member via team share).
  - Team membership role enforcement.
- API tests:
  - Persona CRUD (owner permissions).
  - Team CRUD + membership add/remove.
  - Persona share/unshare.
  - LinkedIn status scoped by persona.
  - OAuth callback binds to persona.
- UI tests:
  - Create persona then connect LinkedIn.
  - Attempt connect without persona (blocked).
  - Role-based visibility of persona settings.

## Acceptance Criteria
- Users can create personas and teams, then share personas with teams.
- LinkedIn connection is persona-scoped and stored under persona token keys.
- Persona access is enforced for all persona and LinkedIn status endpoints.
- UI requires persona selection before connecting LinkedIn.
- Posts remain unchanged and continue to function in legacy user-owned mode.
