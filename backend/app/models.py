import uuid
from datetime import datetime
from typing import Any

from pydantic import EmailStr, model_validator
from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, Relationship, SQLModel


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
class User(UserBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    hashed_password: str
    items: list["Item"] = Relationship(back_populates="owner", cascade_delete=True)
    social_accounts: list["SocialAccount"] = Relationship(
        back_populates="user", cascade_delete=True
    )


# Properties to return via API, id is always required
class UserPublic(UserBase):
    id: uuid.UUID


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
class Item(ItemBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )
    owner: User | None = Relationship(back_populates="items")


class SocialAccount(SQLModel, table=True):
    __tablename__ = "social_account"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )

    platform: str = Field(index=True, max_length=50)  # "linkedin", "x", ...

    # Profile identifiers / display data
    external_user_id: str | None = Field(default=None, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    profile_picture_url: str | None = Field(default=None, max_length=1024)

    # Raw profile metadata (provider-specific)
    raw_profile: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    user: User | None = Relationship(back_populates="social_accounts")


# Properties to return via API, id is always required
class ItemPublic(ItemBase):
    id: uuid.UUID
    owner_id: uuid.UUID


class ItemsPublic(SQLModel):
    data: list[ItemPublic]
    count: int


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


# Shared post properties
class PostBase(SQLModel):
    content: str = Field(min_length=1, max_length=3000)
    image_url: str | None = Field(default=None, max_length=500)
    platform: str = Field(default="all", max_length=50)  # "linkedin", "x", "all"
    status: str = Field(
        default="draft", max_length=50
    )  # "draft", "scheduled", "published", "failed"


# Properties to receive via API on creation
class PostCreate(PostBase):
    scheduled_at: datetime | None = Field(default=None)

    @model_validator(mode="after")
    def validate_scheduled_post(self) -> "PostCreate":
        """Validate that scheduled posts have scheduled_at."""
        if self.status == "scheduled" and self.scheduled_at is None:
            raise ValueError("scheduled_at is required when status is 'scheduled'")
        if self.status == "published" and self.scheduled_at is not None:
            # If publishing immediately, don't require scheduled_at
            pass
        return self


# Properties to receive via API on update
class PostUpdate(SQLModel):
    content: str | None = Field(default=None, min_length=1, max_length=3000)
    image_url: str | None = Field(default=None, max_length=500)
    platform: str | None = Field(default=None, max_length=50)
    scheduled_at: datetime | None = None
    status: str | None = Field(default=None, max_length=50)

    @model_validator(mode="after")
    def validate_scheduled_post(self) -> "PostUpdate":
        """Validate that scheduled posts have scheduled_at."""
        if self.status == "scheduled" and self.scheduled_at is None:
            raise ValueError("scheduled_at is required when status is 'scheduled'")
        return self


# Database model - actual table
class Post(PostBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )
    # External platform linkage (e.g. LinkedIn post URN)
    external_post_id: str | None = Field(default=None, max_length=255)

    # Scheduling
    scheduled_at: datetime | None = None
    published_at: datetime | None = None

    # Engagement metrics (only for published posts)
    likes: int = Field(default=0)
    reposts: int = Field(default=0)
    comments: int = Field(default=0)

    # Timestamps
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    owner: User | None = Relationship()


# Properties to return via API
class PostPublic(PostBase):
    id: uuid.UUID
    owner_id: uuid.UUID
    scheduled_at: datetime | None
    published_at: datetime | None
    likes: int
    reposts: int
    comments: int
    created_at: datetime
    updated_at: datetime
    # Author info will be populated in API layer
    author: dict[str, Any] | None = None


class PostsPublic(SQLModel):
    data: list[PostPublic]
    count: int
