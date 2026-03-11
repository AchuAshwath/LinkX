Generic single-database configuration.

## Full conceptual ER diagram (current design)

```mermaid
erDiagram
  USER {
    UUID id PK
    VARCHAR email "unique, indexed"
    BOOLEAN is_active
    BOOLEAN is_superuser
    VARCHAR full_name
    VARCHAR hashed_password
    TIMESTAMPTZ created_at
    TIMESTAMPTZ updated_at
  }

  ITEM {
    UUID id PK
    VARCHAR title
    VARCHAR description
    TIMESTAMPTZ created_at
    TIMESTAMPTZ updated_at
    UUID owner_id FK
  }

  PERSONA {
    UUID id PK
    UUID user_id FK
    VARCHAR name
    VARCHAR description
    TIMESTAMPTZ created_at
    TIMESTAMPTZ updated_at
  }

  POST {
    UUID id PK
    UUID owner_id FK "legacy, user.id"
    UUID persona_id FK "persona.id"
    VARCHAR content
    VARCHAR image_url
    VARCHAR platform
    VARCHAR status "draft|scheduled|publishing|published|failed"
    TIMESTAMPTZ scheduled_at
    TIMESTAMPTZ published_at
    TIMESTAMPTZ publishing_started_at
    INT retry_count "default 0"
    TIMESTAMPTZ last_retry_at
    TIMESTAMPTZ next_retry_at
    VARCHAR error_code
    VARCHAR error_message
    INT likes
    INT reposts
    INT comments
    VARCHAR external_post_id
    TIMESTAMPTZ created_at
    TIMESTAMPTZ updated_at
  }

  SOCIAL_ACCOUNT {
    UUID id PK
    UUID user_id FK "legacy, user.id"
    UUID persona_id FK "persona.id"
    VARCHAR platform "linkedin/x/..."
    VARCHAR external_user_id
    VARCHAR display_name
    VARCHAR email
    VARCHAR profile_picture_url
    JSONB raw_profile
    TIMESTAMPTZ created_at
    TIMESTAMPTZ updated_at
  }

  TEAM {
    UUID id PK
    UUID owner_user_id FK
    VARCHAR name
    VARCHAR description
    TIMESTAMPTZ created_at
    TIMESTAMPTZ updated_at
  }

  TEAM_MEMBERSHIP {
    UUID id PK
    UUID user_id FK
    UUID team_id FK
    VARCHAR role "member|admin|owner"
  }

  PERSONA_ACCESS {
    UUID id PK
    UUID persona_id FK
    UUID team_id FK
    UUID granted_by_user_id FK
    VARCHAR role "member|admin|owner"
    TIMESTAMPTZ created_at
    TIMESTAMPTZ updated_at
  }

  %% Foreign key relationships (with columns)
  ITEM }o--|| USER : "owner_id -> user.id"
  POST }o--|| USER : "owner_id -> user.id (legacy)"
  POST }o--|| PERSONA : "persona_id -> persona.id"

  PERSONA }o--|| USER : "user_id -> user.id"
  SOCIAL_ACCOUNT }o--|| USER : "user_id -> user.id (legacy)"
  SOCIAL_ACCOUNT }o--|| PERSONA : "persona_id -> persona.id"

  TEAM }o--|| USER : "owner_user_id -> user.id"
  TEAM_MEMBERSHIP }o--|| USER : "user_id -> user.id"
  TEAM_MEMBERSHIP }o--|| TEAM : "team_id -> team.id"

  PERSONA_ACCESS }o--|| PERSONA : "persona_id -> persona.id"
  PERSONA_ACCESS }o--|| TEAM : "team_id -> team.id"
  PERSONA_ACCESS }o--|| USER : "granted_by_user_id -> user.id"
```

## Users and teams

This section focuses on how users, teams, and team membership relate.

### Current conceptual model

```mermaid
erDiagram
  USER {
    UUID id PK
    VARCHAR email "unique, indexed"
    BOOLEAN is_active
    BOOLEAN is_superuser
    VARCHAR full_name
    VARCHAR hashed_password
  }

  TEAM {
    UUID id PK
    UUID owner_user_id FK
    VARCHAR name
    VARCHAR description
  }

  TEAM_MEMBERSHIP {
    UUID id PK
    UUID user_id FK
    UUID team_id FK
    VARCHAR role "member|admin|owner"
  }

  %% Relationships
  TEAM }o--|| USER : "owner_user_id -> user.id"
  TEAM_MEMBERSHIP }o--|| USER : "user_id -> user.id"
  TEAM_MEMBERSHIP }o--|| TEAM : "team_id -> team.id"
```

- A **user** can belong to many teams through `TEAM_MEMBERSHIP`.
- A **team** can have many users.
- The **join table** `TEAM_MEMBERSHIP` is how you represent:
  - "list of teams for a user" (all rows with that `user_id`)
  - "list of users for a team" (all rows with that `team_id`)

### Extensible: richer roles per team (future)

You can later turn simple string roles into a full role system by introducing a `ROLE` dimension and pointing `TEAM_MEMBERSHIP` at it:

```mermaid
erDiagram
  ROLE {
    UUID id PK
    VARCHAR name
    BOOLEAN can_draft
    BOOLEAN can_schedule
    BOOLEAN can_publish
  }

  TEAM_MEMBERSHIP {
    UUID id PK
    UUID user_id FK
    UUID team_id FK
    UUID role_id FK
  }

  %% Relationships
  TEAM_MEMBERSHIP }o--|| ROLE : "role_id -> role.id"
```

This keeps the base `USER` and `TEAM` tables unchanged while allowing you to evolve permissions over time.

## Personas and social accounts

This section focuses on how a user owns personas, and how each persona is connected to social accounts.

### Current conceptual model

```mermaid
erDiagram
  USER {
    UUID id PK
    VARCHAR email "unique, indexed"
    BOOLEAN is_active
    BOOLEAN is_superuser
    VARCHAR full_name
    VARCHAR hashed_password
  }

  PERSONA {
    UUID id PK
    UUID user_id FK
    VARCHAR name
    VARCHAR description
  }

  SOCIAL_ACCOUNT {
    UUID id PK
    UUID persona_id FK
    VARCHAR platform "linkedin/x/..."
    VARCHAR external_user_id
    VARCHAR display_name
    VARCHAR email
    VARCHAR profile_picture_url
    JSONB raw_profile
  }

  %% Relationships
  PERSONA }o--|| USER : "user_id -> user.id"
  SOCIAL_ACCOUNT }o--|| PERSONA : "persona_id -> persona.id"
```

- A **user** can own many **personas**.
- Each **persona** can have at most one social account per platform (enforced with a unique index on `(persona_id, platform)`).
- `SOCIAL_ACCOUNT` stores platform-specific details (profile metadata, external IDs, etc.).

### Extensible: persona access via teams (current Phase 1)

As of Phase 1, personas are shared with teams using role-based access:

```mermaid
erDiagram
  PERSONA {
    UUID id PK
    UUID user_id FK
    VARCHAR name
    VARCHAR description
  }

  TEAM {
    UUID id PK
    UUID owner_user_id FK
    VARCHAR name
    VARCHAR description
  }

  PERSONA_ACCESS {
    UUID id PK
    UUID persona_id FK
    UUID team_id FK
    UUID granted_by_user_id FK
    VARCHAR role "member|admin|owner"
  }

  USER {
    UUID id PK
    VARCHAR email
    VARCHAR full_name
  }

  %% Relationships
  PERSONA_ACCESS }o--|| PERSONA : "persona_id -> persona.id"
  PERSONA_ACCESS }o--|| TEAM : "team_id -> team.id"
  PERSONA_ACCESS }o--|| USER : "granted_by_user_id -> user.id"
```

This allows:

- Personas to be shared with teams using explicit role grants.
- Team members to inherit persona access via `PERSONA_ACCESS` with their effective role.
- Persona owner can grant/revoke team-level access without direct user grants (v1).

## Posts and scheduling reliability

This section focuses on how posts relate to personas and the state machine for scheduling/publishing.

### Current conceptual model (Phase 3)

```mermaid
erDiagram
  PERSONA {
    UUID id PK
    UUID user_id FK
    VARCHAR name
    VARCHAR description
  }

  POST {
    UUID id PK
    UUID persona_id FK
    UUID owner_id FK "legacy, user.id"
    VARCHAR content
    VARCHAR image_url
    VARCHAR platform
    VARCHAR status "draft|scheduled|publishing|published|failed"
    TIMESTAMPTZ scheduled_at
    TIMESTAMPTZ published_at
    TIMESTAMPTZ publishing_started_at
    INT retry_count
    TIMESTAMPTZ last_retry_at
    TIMESTAMPTZ next_retry_at
    VARCHAR error_code
    VARCHAR error_message
    VARCHAR external_post_id
    INT likes
    INT reposts
    INT comments
  }

  SOCIAL_ACCOUNT {
    UUID id PK
    UUID persona_id FK
    VARCHAR platform
    VARCHAR external_user_id
  }

  %% Relationships
  POST }o--|| PERSONA : "persona_id -> persona.id"
  SOCIAL_ACCOUNT }o--|| PERSONA : "persona_id -> persona.id"
```

- Each **post** belongs to exactly one **persona**.
- Posts track their **status** through the state machine: `draft` → `scheduled` → `publishing` → `published` or `failed`.
- Retry fields (`retry_count`, `last_retry_at`, `next_retry_at`, `error_code`, `error_message`) support automatic retry with exponential backoff.
- `publishing_started_at` tracks when a publish attempt began.
- `external_post_id` ensures idempotent publishing (no duplicates if scheduler runs twice).
- `owner_id` is retained as legacy storage for backwards compatibility; `persona_id` is the primary ownership boundary.

### Status transitions (Phase 3 State Machine)

```
draft
  ↓ (schedule for later)
scheduled
  ↓ (wait for scheduled time)
publishing (scheduler transitions to this before attempting publish)
  ├─ ✓ (success) → published
  └─ ✗ (error) → failed (non-retryable) OR remain scheduled (retryable, reschedule with backoff)

failed (terminal, non-retryable error)
  ↓ (manual retry only, admin/owner)
scheduled (reschedule for immediate or future retry)
```

### Retry and error handling

- **Retryable errors** (429 rate limit, 5xx server error, network timeout): Keep status `scheduled`, increment `retry_count`, set `next_retry_at = NOW + (60 * 2^retry_count)`.
- **Non-retryable errors** (401 unauthorized, 400 bad request): Set status `failed`, store `error_code` and `error_message`.
- **Max retries** (default 3): After exceeding `MAX_RETRIES`, mark as `failed` and require manual intervention.
- **Idempotency**: If `external_post_id` is already set, do not re-publish (prevents duplicates).
