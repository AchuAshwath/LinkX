import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import EmailStr
from sqlalchemy import Column, DateTime, UniqueConstraint
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


class PersonaBase(SQLModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None, max_length=500)


class PersonaCreate(PersonaBase):
    pass


class PersonaUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=500)


class PersonaPublic(PersonaBase):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PersonasPublic(SQLModel):
    data: list[PersonaPublic]
    count: int


class PersonaRolePublic(SQLModel):
    role: str


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
    persona_id: uuid.UUID


class PostUpdate(SQLModel):
    content: str | None = Field(default=None, min_length=1, max_length=3000)
    image_url: str | None = Field(default=None, max_length=500)
    platform: str | None = Field(default=None, max_length=50)
    status: str | None = Field(default=None, max_length=50)
    persona_id: uuid.UUID | None = None
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
    publishing_started_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    retry_count: int = 0
    last_retry_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    next_retry_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    error_code: str | None = Field(default=None, max_length=100)
    error_message: str | None = Field(default=None, max_length=1000)
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
    publishing_started_at: datetime | None = None
    retry_count: int = 0
    last_retry_at: datetime | None = None
    next_retry_at: datetime | None = None
    error_code: str | None = None
    error_message: str | None = None
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


class PublishErrorResponse(SQLModel):
    error: str
    message: str
    retryable: bool
    details: dict[str, Any] | None = None
    trace_id: str


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


class TeamBase(SQLModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None, max_length=500)


class TeamCreate(TeamBase):
    pass


class TeamUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=500)


class TeamPublic(TeamBase):
    id: uuid.UUID
    owner_user_id: uuid.UUID
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TeamsPublic(SQLModel):
    data: list[TeamPublic]
    count: int


class TeamMembership(SQLModel, table=True):
    """Join table between users and teams.

    The `role` field is a simple string/enum for now and can later be
    replaced or complemented by a ROLE dimension table.
    """

    __tablename__ = "team_membership"
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


class TeamMembershipCreate(SQLModel):
    user_id: uuid.UUID
    role: str = Field(default="member", max_length=50)


class TeamMembershipPublic(SQLModel):
    id: uuid.UUID
    user_id: uuid.UUID
    team_id: uuid.UUID
    role: str


class PersonaAccess(TimestampedUUIDModel, table=True):
    __tablename__ = "persona_access"
    persona_id: uuid.UUID = Field(
        foreign_key="persona.id",
        nullable=False,
        ondelete="CASCADE",
    )
    team_id: uuid.UUID = Field(
        foreign_key="team.id",
        nullable=False,
        ondelete="CASCADE",
    )
    granted_by_user_id: uuid.UUID = Field(
        foreign_key="user.id",
        nullable=False,
        ondelete="CASCADE",
    )
    role: str = Field(default="member", max_length=50)


class PersonaAccessCreate(SQLModel):
    team_id: uuid.UUID
    role: str = Field(default="member", max_length=50)


class PersonaAccessPublic(SQLModel):
    id: uuid.UUID
    persona_id: uuid.UUID
    team_id: uuid.UUID
    granted_by_user_id: uuid.UUID
    role: str
    created_at: datetime | None = None
    updated_at: datetime | None = None


# --- Trending Topics ---


class TrendingTopic(TimestampedUUIDModel, table=True):
    __tablename__ = "trending_topic"
    __table_args__ = (
        UniqueConstraint("user_id", "topic_url", name="uq_trending_topic_user_url"),
    )

    user_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )
    topic_url: str = Field(max_length=512, index=True)
    topic_title: str = Field(max_length=500)
    category: str | None = Field(default=None, max_length=100)
    post_count: int | None = Field(default=None)
    summary: str | None = Field(default=None)
    first_seen_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    last_seen_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    scraped_at: datetime = Field(sa_type=DateTime(timezone=True))  # type: ignore


class TrendingTweet(TimestampedUUIDModel, table=True):
    __tablename__ = "trending_tweet"

    topic_id: uuid.UUID = Field(
        foreign_key="trending_topic.id", nullable=False, ondelete="CASCADE"
    )
    author_handle: str = Field(max_length=255)
    text: str
    replies: int | None = Field(default=None)
    retweets: int | None = Field(default=None)
    likes: int | None = Field(default=None)
    views: int | None = Field(default=None)


class TrendingTopicPublic(SQLModel):
    id: uuid.UUID
    topic_title: str
    category: str | None
    post_count: int | None
    topic_url: str
    first_seen_at: datetime | None
    last_seen_at: datetime | None
    scraped_at: datetime


class TrendingTopicsPublic(SQLModel):
    data: list[TrendingTopicPublic]
    count: int
