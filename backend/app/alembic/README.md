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

  POST {
    UUID id PK
    UUID persona_id FK
    VARCHAR content
    VARCHAR image_url
    VARCHAR platform
    VARCHAR status
    TIMESTAMPTZ scheduled_at
    TIMESTAMPTZ published_at
    INT likes
    INT reposts
    INT comments
    TIMESTAMPTZ created_at
    TIMESTAMPTZ updated_at
    VARCHAR external_post_id
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
    VARCHAR role "optional: admin/member/viewer"
  }

  PERSONA {
    UUID id PK
    UUID user_id FK
    VARCHAR name
    VARCHAR description
    TIMESTAMPTZ created_at
    TIMESTAMPTZ updated_at
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
    TIMESTAMPTZ created_at
    TIMESTAMPTZ updated_at
  }

  %% Foreign key relationships (with columns)
  ITEM }o--|| USER : "owner_id -> user.id"
  POST }o--|| PERSONA : "persona_id -> persona.id"

  TEAM }o--|| USER : "owner_user_id -> user.id"
  TEAM_MEMBERSHIP }o--|| USER : "user_id -> user.id"
  TEAM_MEMBERSHIP }o--|| TEAM : "team_id -> team.id"

  PERSONA }o--|| USER : "user_id -> user.id"
  SOCIAL_ACCOUNT }o--|| PERSONA : "persona_id -> persona.id"
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
    VARCHAR role "optional: admin/member/viewer"
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
    BOOLEAN canDraft
    BOOLEAN canSchedule
    BOOLEAN canPublish
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
  }

  %% Relationships
  PERSONA }o--|| USER : "user_id -> user.id"
  SOCIAL_ACCOUNT }o--|| PERSONA : "persona_id -> persona.id"
```

- A **user** can own many **personas**.
- Each **persona** can have at most one social account per platform (enforced later with a unique index on `(persona_id, platform)`).
- `SOCIAL_ACCOUNT` stores platform-specific details (profile metadata, external IDs, etc.).

### Extensible: persona access and roles (future)

Later, you can grant access to personas for specific users or teams using the same dim + join pattern as teams:

```mermaid
erDiagram
  ROLE {
    UUID id PK
    VARCHAR name
    BOOLEAN canDraft
    BOOLEAN canSchedule
    BOOLEAN canPublish
  }

  PERSONA_ACCESS {
    UUID id PK
    UUID persona_id FK
    UUID user_id FK
    UUID role_id FK
  }

  %% Relationships
  PERSONA_ACCESS }o--|| PERSONA : "persona_id -> persona.id"
  PERSONA_ACCESS }o--|| USER : "user_id -> user.id"
  PERSONA_ACCESS }o--|| ROLE : "role_id -> role.id"
```

This allows:

- Multiple users to collaborate on the same persona with different permissions.
- Evolving your permission model without changing the core `PERSONA` or `SOCIAL_ACCOUNT` tables.
