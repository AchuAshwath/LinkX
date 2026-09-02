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


# --- Post (LinkedIn/X/social posts) ---


class PostBase(SQLModel):
    content: str = Field(min_length=1, max_length=25000)
    image_url: str | None = Field(default=None, max_length=500)
    platform: str = Field(max_length=50)  # linkedin, x, all
    method: str = Field(default="api", max_length=50)  # api, browser, vision
    status: str = Field(max_length=50)  # draft, scheduled, published, failed
    scheduled_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class PostCreate(PostBase):
    pass


class PostUpdate(SQLModel):
    content: str | None = Field(default=None, min_length=1, max_length=25000)
    image_url: str | None = Field(default=None, max_length=500)
    platform: str | None = Field(default=None, max_length=50)
    method: str | None = Field(default=None, max_length=50)
    status: str | None = Field(default=None, max_length=50)
    scheduled_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class Post(TimestampedUUIDModel, PostBase, table=True):
    __tablename__ = "post"
    owner_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
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


class MediaPublic(SQLModel):
    url: str
    filename: str
    content_type: str
    size_bytes: int


class AIDraftRequest(SQLModel):
    prompt: str = Field(default="", max_length=25000)
    platform: str = Field(default="linkx", max_length=50)
    tone: str | None = Field(default=None, max_length=50)


class AIDraftResponse(SQLModel):
    content: str
    post_id: uuid.UUID | None = None


# --- SocialAccount (OAuth / Browser session metadata) ---


class SocialAccount(TimestampedUUIDModel, table=True):
    __tablename__ = "social_account"
    __table_args__ = (
        UniqueConstraint("user_id", "platform", name="uq_social_account_user_platform"),
    )
    user_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
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


# --- AI Chat Threads & Conversations ---


class ChatThreadBase(SQLModel):
    title: str = Field(max_length=200)
    origin: str = Field(
        default="manual", max_length=20
    )  # "composer" | "trending" | "manual"


class ChatThreadCreate(SQLModel):
    origin: str = Field(default="manual", max_length=20)
    prompt: str | None = Field(default=None, max_length=25000)
    post_id: uuid.UUID | None = None
    topic_keyword: str | None = Field(default=None, max_length=200)


class ChatThreadUpdate(SQLModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    is_archived: bool | None = None


class ChatThread(TimestampedUUIDModel, ChatThreadBase, table=True):
    __tablename__ = "chat_thread"

    owner_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )
    post_id: uuid.UUID | None = Field(
        default=None, foreign_key="post.id", nullable=True, ondelete="SET NULL"
    )
    topic_keyword: str | None = Field(default=None, max_length=200)
    message_count: int = Field(default=0)
    is_archived: bool = Field(default=False)
    transcript: dict[str, Any] = Field(
        default_factory=lambda: {"messages": []},
        sa_column=Column(JSONB),
    )


class ChatThreadPublic(ChatThreadBase):
    id: uuid.UUID
    owner_id: uuid.UUID
    post_id: uuid.UUID | None = None
    topic_keyword: str | None = None
    message_count: int = 0
    is_archived: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ChatThreadDetail(ChatThreadPublic):
    transcript: dict[str, Any] = Field(default_factory=lambda: {"messages": []})


class ChatThreadsPublic(SQLModel):
    data: list[ChatThreadPublic]
    count: int


class AIModelInfo(SQLModel):
    id: str
    name: str
    provider: str | None = None
    is_default: bool = False


class AIModelsPublic(SQLModel):
    data: list[AIModelInfo]
    default_model: str


class ChatMessageRequest(SQLModel):
    message: str = Field(min_length=1, max_length=25000)
    model: str | None = Field(default=None, max_length=100)
