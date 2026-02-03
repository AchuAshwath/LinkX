## Example: Adding a new model & CRUD API (using `Item`)

This document walks through the original **`Item`** feature from the FastAPI template
and uses it as a **worked example** for how to add a new model, CRUD API, migrations,
and tests in this project.

Use this as a pattern when you add new backend features (for example, `Persona`,
`Team`, or any other entity).

- **Backend code lives in** `backend/app/`
- **Tests live in** `backend/tests/`
- **Migrations live in** `backend/app/alembic/`

---

## 1. Designing the model & schemas

In this codebase we follow a consistent pattern:

- A **SQLModel table** that maps to a DB table (e.g. `Item`)
- A set of **Pydantic-style schemas** for:
  - shared fields (e.g. `ItemBase`)
  - creation (`ItemCreate`)
  - update (`ItemUpdate`)
  - API responses (`ItemPublic`, `ItemsPublic`)

From `app/models.py`:

```python
class ItemBase(SQLModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=255)


class ItemCreate(ItemBase):
    pass


class ItemUpdate(ItemBase):
    title: str | None = Field(default=None, min_length=1, max_length=255)  # type: ignore
```

The **table model** embeds the base fields and adds database-specific columns
like `id`, `created_at`, and foreign keys:

```python
class Item(ItemBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    owner_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )
    owner: User | None = Relationship(back_populates="items")
```

On the **User** side we define the inverse relationship:

```python
class User(UserBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    hashed_password: str
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    items: list["Item"] = Relationship(back_populates="owner", cascade_delete=True)
```

For API responses we define explicit schemas:

```python
class ItemPublic(ItemBase):
    id: uuid.UUID
    owner_id: uuid.UUID
    created_at: datetime | None = None


class ItemsPublic(SQLModel):
    data: list[ItemPublic]
    count: int
```

### Pattern to follow for a new entity `Foo`

1. Define `FooBase` with **shared fields** and validation.
2. Define:
   - `FooCreate(FooBase)` for creation
   - `FooUpdate(FooBase)` where all fields are optional
3. Define `Foo(FooBase, table=True)` with:
   - `id` as `uuid.UUID`
   - any foreign keys (e.g. `owner_id`)
   - relationships using `Relationship`
4. Define:
   - `FooPublic` for API responses
   - `FoosPublic` (wrapper with `data` + `count`)

This keeps schemas clear and keeps DB-specific concerns in the table model.

---

## 2. Database migrations for a new model

Migrations for `Item` live under `app/alembic/versions/` and show how the model
evolved over time:

- **Initial creation**:
  - `e2412789c190_initialize_models.py`
- **String length constraints**:
  - `9c0a54914c78_add_max_length_for_string_varchar_.py`
- **Integer → UUID conversion**:
  - `d98dd8ec85a3_edit_replace_id_integers_in_all_models_.py`
- **Cascade deletes**:
  - `1a31ce608336_add_cascade_delete_relationships.py`
- **Timestamps**:
  - `fe56fa70289e_add_created_at_to_user_and_item.py`

Key practices (see `backend/app/alembic/README.md` and `backend/README.md`):

- **Never edit historical migrations** after they’ve been applied.
- Instead, **add a new revision** whenever you change models.
- Alembic is configured to read models from `app/models.py`.

Typical workflow (inside the backend container):

```bash
docker compose exec backend bash

# After changing models in app/models.py
alembic revision --autogenerate -m "Add Foo model"
alembic upgrade head
```

For a new entity `Foo`, Alembic will generate a `CREATE TABLE foo (...)` migration
based on your `Foo` SQLModel definition.

---

## 3. CRUD helpers

Some entities have small helper functions in `app/crud.py`. For `Item` the
helper looks like this:

```python
def create_item(*, session: Session, item_in: ItemCreate, owner_id: uuid.UUID) -> Item:
    db_item = Item.model_validate(item_in, update={"owner_id": owner_id})
    session.add(db_item)
    session.commit()
    session.refresh(db_item)
    return db_item
```

This shows the typical pattern:

- Accept an injected `Session`
- Accept a `...Create` schema and any extra fields (like `owner_id`)
- Use `model_validate` to combine schema and extra data
- `add` → `commit` → `refresh` → return the DB object

### Template for a new helper

```python
def create_foo(*, session: Session, foo_in: FooCreate, owner_id: uuid.UUID) -> Foo:
    db_foo = Foo.model_validate(foo_in, update={"owner_id": owner_id})
    session.add(db_foo)
    session.commit()
    session.refresh(db_foo)
    return db_foo
```

You can add more helpers (e.g. `get_foo`, `get_foos`, `update_foo`, `delete_foo`)
in the same style as the Post helpers already present in `crud.py`.

---

## 4. API routes for CRUD

The `Item` API lives in `app/api/routes/items.py` and demonstrates a complete,
auth-protected CRUD router.

Router setup:

```python
router = APIRouter(prefix="/items", tags=["items"])
```

### List items

```python
@router.get("/", response_model=ItemsPublic)
def read_items(
    session: SessionDep, current_user: CurrentUser, skip: int = 0, limit: int = 100
) -> Any:
    if current_user.is_superuser:
        count_statement = select(func.count()).select_from(Item)
        count = session.exec(count_statement).one()
        statement = (
            select(Item).order_by(Item.created_at.desc()).offset(skip).limit(limit)
        )
        items = session.exec(statement).all()
    else:
        count_statement = (
            select(func.count())
            .select_from(Item)
            .where(Item.owner_id == current_user.id)
        )
        count = session.exec(count_statement).one()
        statement = (
            select(Item)
            .where(Item.owner_id == current_user.id)
            .order_by(Item.created_at.desc())
            .offset(skip)
            .limit(limit)
        )
        items = session.exec(statement).all()

    return ItemsPublic(data=items, count=count)
```

Patterns to notice:

- Uses `SessionDep` and `CurrentUser` dependencies from `app/api/deps.py`.
- Applies **authorization rules**: superusers see everything; normal users
  only see their own rows.
- Returns the `ItemsPublic` wrapper for pagination metadata.

### Read, create, update, delete

```python
@router.get("/{id}", response_model=ItemPublic)
def read_item(session: SessionDep, current_user: CurrentUser, id: uuid.UUID) -> Any:
    item = session.get(Item, id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if not current_user.is_superuser and (item.owner_id != current_user.id):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return item


@router.post("/", response_model=ItemPublic)
def create_item(
    *, session: SessionDep, current_user: CurrentUser, item_in: ItemCreate
) -> Any:
    item = Item.model_validate(item_in, update={"owner_id": current_user.id})
    session.add(item)
    session.commit()
    session.refresh(item)
    return item
```

The update and delete endpoints follow the same pattern:

- Load the object with `session.get`
- Return 404 if missing
- Enforce authorization (owner or superuser)
- Apply `model_dump(exclude_unset=True)` for partial updates
- Commit & return

### Pattern for a new router

For a new entity `Foo`:

1. Create `app/api/routes/foo.py`:
   - `router = APIRouter(prefix="/foos", tags=["foos"])`
   - `read_foos`, `read_foo`, `create_foo`, `update_foo`, `delete_foo`
2. Use the same dependency style:
   - `session: SessionDep`
   - `current_user: CurrentUser`
3. Register the router in `app/api/main.py`:

```python
from app.api.routes import items, users, posts  # etc.

api_router.include_router(items.router)
api_router.include_router(users.router)
```

Replace `items` with your new module name.

---

## 5. Tests for CRUD endpoints

The file `backend/tests/api/routes/test_items.py` contains a full test suite
for the Items API.

Example: creating an item

```python
def test_create_item(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    data = {"title": "Foo", "description": "Fighters"}
    response = client.post(
        f"{settings.API_V1_STR}/items/",
        headers=superuser_token_headers,
        json=data,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["title"] == data["title"]
    assert content["description"] == data["description"]
    assert "id" in content
    assert "owner_id" in content
```

The tests use:

- `TestClient` from FastAPI
- Shared fixtures from `backend/tests/conftest.py`:
  - `client`
  - `db`
  - `superuser_token_headers`
  - `normal_user_token_headers`
- Helper function from `backend/tests/utils/item.py`:

```python
def create_random_item(db: Session) -> Item:
    user = create_random_user(db)
    owner_id = user.id
    title = random_lower_string()
    description = random_lower_string()
    item_in = ItemCreate(title=title, description=description)
    return crud.create_item(session=db, item_in=item_in, owner_id=owner_id)
```

### Test naming pattern

- `test_create_<entity>`
- `test_read_<entity>`
- `test_update_<entity>`
- `test_delete_<entity>`
- plus edge cases:
  - `..._not_found`
  - `..._not_enough_permissions`

For a new entity `Foo`, copy this pattern into `backend/tests/api/routes/test_foos.py`
and create a `create_random_foo` helper in `backend/tests/utils/foo.py`.

---

## 6. (Optional) Frontend wiring pattern

Although this document focuses on the backend, the original Items feature also
had a small frontend:

- Route file: `frontend/src/routes/_layout/items.tsx`
- Components: `frontend/src/components/Items/*`
- API client: `ItemsService` in `frontend/src/client/sdk.gen.ts`

High-level pattern:

1. Backend exposes `/api/v1/items` with OpenAPI schemas (`ItemPublic`, etc.).
2. `pnpm run generate-client` generates a typed client.
3. The route component calls `ItemsService` methods (list/create/delete).
4. UI is built with shadcn/ui + a DataTable over the typed data.

You can follow the same pattern for any new backend resource you expose.

---

## 7. Checklist: adding a new backend feature

When you add a new feature (e.g. `Foo`), use this checklist:

- **Models & schemas**
  - [ ] Add `FooBase`, `FooCreate`, `FooUpdate`, `Foo`, `FooPublic`, `FoosPublic`
        to `backend/app/models.py`.
  - [ ] Add relationships on related models (e.g. `User.foos`).

- **Migrations**
  - [ ] Generate a new Alembic revision after changing models:
        `alembic revision --autogenerate -m "Add Foo model"`
  - [ ] Run `alembic upgrade head`.

- **CRUD & routes**
  - [ ] (Optional) Add helpers to `backend/app/crud.py`.
  - [ ] Add a new router in `backend/app/api/routes/foo.py`.
  - [ ] Register the router in `backend/app/api/main.py`.

- **Tests**
  - [ ] Add tests under `backend/tests/api/routes/test_foos.py`.
  - [ ] Add any helpers under `backend/tests/utils/foo.py`.

- **Frontend (optional)**
  - [ ] Regenerate the frontend client (`pnpm run generate-client`).
  - [ ] Add a route and components to consume the new API.

The original **Items** feature is a complete, end-to-end example of this
process. Refer back to the files referenced above whenever you need a concrete
pattern to copy.

