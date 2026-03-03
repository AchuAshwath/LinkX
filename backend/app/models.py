import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import EmailStr
from sqlalchemy import Column, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, Relationship, SQLModel


def get_datetime_utc() -> datetime:
    return datetime.now(timezone.utc)


# Base model shared by most DB tables: UUID primary key + timestamps.
class TimestampedUUIDModel(SQLModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


# Shared properties
class UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = True
    is_superuser: bool = False
    full_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on creation
class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserRegister(SQLModel):
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on update, all are optional
class UserUpdate(UserBase):
    email: EmailStr | None = Field(default=None, max_length=255)  # type: ignore
    password: str | None = Field(default=None, min_length=8, max_length=128)


class UserUpdateMe(SQLModel):
    full_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = Field(default=None, max_length=255)


class UpdatePassword(SQLModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# Database model, database table inferred from class name
class User(TimestampedUUIDModel, UserBase, table=True):
    hashed_password: str
    items: list["Item"] = Relationship(back_populates="owner", cascade_delete=True)


# Properties to return via API, id is always required
class UserPublic(UserBase):
    id: uuid.UUID
    created_at: datetime | None = None


class UsersPublic(SQLModel):
    data: list[UserPublic]
    count: int


# Shared properties
class ItemBase(SQLModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=255)


# Properties to receive on item creation
class ItemCreate(ItemBase):
    pass


# Properties to receive on item update
class ItemUpdate(ItemBase):
    title: str | None = Field(default=None, min_length=1, max_length=255)  # type: ignore


# Database model, database table inferred from class name
class Item(TimestampedUUIDModel, ItemBase, table=True):
    owner_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )
    owner: User | None = Relationship(back_populates="items")


# Properties to return via API, id is always required
class ItemPublic(ItemBase):
    id: uuid.UUID
    owner_id: uuid.UUID
    created_at: datetime | None = None


class ItemsPublic(SQLModel):
    data: list[ItemPublic]
    count: int


# --- Persona and Post (LinkedIn/social posts) ---


class Persona(TimestampedUUIDModel, table=True):
    """Content identity/brand owned by a user.

    In the future this can be associated with teams and richer access controls
    without changing this core shape.
    """

    user_id: uuid.UUID = Field(
        foreign_key="user.id",
        nullable=False,
        ondelete="CASCADE",
    )
    name: str = Field(max_length=255)
    description: str | None = Field(default=None, max_length=500)


class PostBase(SQLModel):
    content: str = Field(min_length=1, max_length=3000)
    image_url: str | None = Field(default=None, max_length=500)
    platform: str = Field(max_length=50)  # linkedin, x, all
    status: str = Field(max_length=50)  # draft, scheduled, published, failed
    scheduled_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class PostCreate(PostBase):
    pass


class PostUpdate(SQLModel):
    content: str | None = Field(default=None, min_length=1, max_length=3000)
    image_url: str | None = Field(default=None, max_length=500)
    platform: str | None = Field(default=None, max_length=50)
    status: str | None = Field(default=None, max_length=50)
    scheduled_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class Post(TimestampedUUIDModel, PostBase, table=True):
    __tablename__ = "post"
    # Legacy owner_id kept for backward compatibility; will be removed
    # after persona_id is fully adopted across the codebase.
    owner_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )
    persona_id: uuid.UUID | None = Field(
        default=None,
        foreign_key="persona.id",
        nullable=True,
        ondelete="CASCADE",
    )
    scheduled_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    published_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    likes: int = 0
    reposts: int = 0
    comments: int = 0
    external_post_id: str | None = Field(default=None, max_length=255)


class PostAuthor(SQLModel):
    name: str
    username: str
    avatarUrl: str | None = None


class PostPublic(PostBase):
    id: uuid.UUID
    owner_id: uuid.UUID
    persona_id: uuid.UUID | None = None
    published_at: datetime | None = None
    likes: int = 0
    reposts: int = 0
    comments: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None
    external_post_id: str | None = None
    author: PostAuthor | None = None


class PostsPublic(SQLModel):
    data: list[PostPublic]
    count: int


# --- SocialAccount (OAuth / LinkedIn profile metadata) ---


class SocialAccount(TimestampedUUIDModel, table=True):
    __tablename__ = "social_account"
    # Legacy user_id kept for backward compatibility; will be removed
    # after persona_id is fully adopted across the codebase.
    user_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )
    persona_id: uuid.UUID | None = Field(
        default=None,
        foreign_key="persona.id",
        nullable=True,
        ondelete="CASCADE",
    )
    platform: str = Field(max_length=50, index=True)
    external_user_id: str | None = Field(default=None, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    profile_picture_url: str | None = Field(default=None, max_length=1024)
    raw_profile: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))


# Generic message
class Message(SQLModel):
    message: str


# JSON payload containing access token
class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"


# Contents of JWT token
class TokenPayload(SQLModel):
    sub: str | None = None


class NewPassword(SQLModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


# --- Teams (future-ready) ---


class Team(TimestampedUUIDModel, table=True):
    """Team/organization grouping users.

    For now this is a simple owner-owned team; richer access control can be
    built on top via TeamMembership and roles.
    """

    owner_user_id: uuid.UUID = Field(
        foreign_key="user.id",
        nullable=False,
        ondelete="CASCADE",
    )
    name: str = Field(max_length=255)
    description: str | None = Field(default=None, max_length=500)


class TeamMembership(SQLModel, table=True):
    """Join table between users and teams.

    The `role` field is a simple string/enum for now and can later be
    replaced or complemented by a ROLE dimension table.
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(
        foreign_key="user.id",
        nullable=False,
        ondelete="CASCADE",
    )
    team_id: uuid.UUID = Field(
        foreign_key="team.id",
        nullable=False,
        ondelete="CASCADE",
    )
    role: str = Field(default="member", max_length=50)
