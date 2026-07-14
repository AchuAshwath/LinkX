import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, delete, func, select

from app.core.security import get_password_hash, verify_password
from app.models import (
    Item,
    ItemCreate,
    Post,
    PostCreate,
    PostUpdate,
    TrendingTopic,
    TrendingTweet,
    User,
    UserCreate,
    UserUpdate,
)
from app.services.post_state_machine import validate_transition


def create_user(*, session: Session, user_create: UserCreate) -> User:
    db_obj = User.model_validate(
        user_create, update={"hashed_password": get_password_hash(user_create.password)}
    )
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    return db_obj


def update_user(*, session: Session, db_user: User, user_in: UserUpdate) -> Any:
    user_data = user_in.model_dump(exclude_unset=True)
    extra_data = {}
    if "password" in user_data:
        password = user_data["password"]
        hashed_password = get_password_hash(password)
        extra_data["hashed_password"] = hashed_password
    db_user.sqlmodel_update(user_data, update=extra_data)
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user


def get_user_by_email(*, session: Session, email: str) -> User | None:
    statement = select(User).where(User.email == email)
    session_user = session.exec(statement).first()
    return session_user


# Dummy hash to use for timing attack prevention when user is not found
# This is an Argon2 hash of a random password, used to ensure constant-time comparison
DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$MjQyZWE1MzBjYjJlZTI0Yw$YTU4NGM5ZTZmYjE2NzZlZjY0ZWY3ZGRkY2U2OWFjNjk"


def authenticate(*, session: Session, email: str, password: str) -> User | None:
    db_user = get_user_by_email(session=session, email=email)
    if not db_user:
        # Prevent timing attacks by running password verification even when user doesn't exist
        # This ensures the response time is similar whether or not the email exists
        verify_password(password, DUMMY_HASH)
        return None
    verified, updated_password_hash = verify_password(password, db_user.hashed_password)
    if not verified:
        return None
    if updated_password_hash:
        db_user.hashed_password = updated_password_hash
        session.add(db_user)
        session.commit()
        session.refresh(db_user)
    return db_user


def create_item(*, session: Session, item_in: ItemCreate, owner_id: uuid.UUID) -> Item:
    db_item = Item.model_validate(item_in, update={"owner_id": owner_id})
    session.add(db_item)
    session.commit()
    session.refresh(db_item)
    return db_item


def create_post(*, session: Session, post_in: PostCreate, owner_id: uuid.UUID) -> Post:
    """Create a new post."""
    # Validate business rules
    if post_in.status == "scheduled" and post_in.scheduled_at is None:
        raise ValueError("scheduled_at is required when status is 'scheduled'")

    db_post = Post.model_validate(
        post_in,
        update={"owner_id": owner_id, "persona_id": post_in.persona_id},
    )
    session.add(db_post)
    session.commit()
    session.refresh(db_post)
    return db_post


def get_post(*, session: Session, post_id: uuid.UUID) -> Post | None:
    """Get a post by ID."""
    return session.get(Post, post_id)


def get_posts(
    *,
    session: Session,
    owner_id: uuid.UUID | None = None,
    persona_id: uuid.UUID | None = None,
    status: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[Post], int]:
    """Get posts with optional filtering."""
    statement = select(Post)
    count_statement = select(func.count()).select_from(Post)

    if owner_id:
        statement = statement.where(Post.owner_id == owner_id)
        count_statement = count_statement.where(Post.owner_id == owner_id)

    if persona_id:
        statement = statement.where(Post.persona_id == persona_id)
        count_statement = count_statement.where(Post.persona_id == persona_id)

    if status:
        statement = statement.where(Post.status == status)
        count_statement = count_statement.where(Post.status == status)

    count = session.exec(count_statement).one()
    posts = session.exec(statement.offset(skip).limit(limit)).all()
    posts_list: list[Post] = list(posts)

    return posts_list, count


def update_post(*, session: Session, db_post: Post, post_in: PostUpdate) -> Post:
    """Update a post."""
    # Validate business rules
    update_data = post_in.model_dump(exclude_unset=True)

    # If status is being updated to 'scheduled', ensure scheduled_at exists
    if "status" in update_data:
        new_status = update_data["status"]
        validate_transition(current_status=db_post.status, target_status=new_status)
        if new_status == "scheduled":
            # Check if scheduled_at is being set in this update or already exists
            if "scheduled_at" not in update_data and db_post.scheduled_at is None:
                raise ValueError("scheduled_at is required when status is 'scheduled'")
        elif new_status == "published":
            # Set published_at if not already set
            if db_post.published_at is None:
                update_data["published_at"] = datetime.utcnow()

    db_post.sqlmodel_update(update_data)
    db_post.updated_at = datetime.utcnow()
    session.add(db_post)
    session.commit()
    session.refresh(db_post)
    return db_post


def delete_post(*, session: Session, post_id: uuid.UUID) -> None:
    """Delete a post."""
    post = session.get(Post, post_id)
    if post:
        session.delete(post)
        session.commit()


# --- Trending Topics ---


def upsert_trending_topic(
    *, session: Session, topic_data: dict[str, Any]
) -> TrendingTopic:
    """Insert or update a trending topic based on (user_id, topic_url)."""
    insert_stmt = insert(TrendingTopic).values(**topic_data)

    # Update all fields except id, user_id, topic_url, and created_at on conflict
    update_dict = {
        c.name: c
        for c in insert_stmt.excluded
        if c.name not in ["id", "user_id", "topic_url", "created_at", "updated_at"]
    }
    update_dict["updated_at"] = func.now()  # type: ignore[assignment]

    upsert_stmt = insert_stmt.on_conflict_do_update(
        constraint="uq_trending_topic_user_url", set_=update_dict
    ).returning(TrendingTopic)

    row = session.exec(upsert_stmt).first()
    session.commit()
    if not row:
        raise RuntimeError(
            "upsert_trending_topic returned no row — constraint or driver issue"
        )
    return row[0]  # type: ignore[no-any-return]


def replace_trending_tweets(
    *, session: Session, topic_id: uuid.UUID, tweets_data: list[dict[str, Any]]
) -> None:
    """Delete old tweets for a topic and insert new ones."""
    # Delete old tweets in a single query
    stmt_delete = delete(TrendingTweet).where(TrendingTweet.topic_id == topic_id)  # type: ignore
    session.exec(stmt_delete)

    # Insert new tweets
    for t_data in tweets_data:
        db_tweet = TrendingTweet(**t_data, topic_id=topic_id)
        session.add(db_tweet)

    session.commit()


def get_latest_trending_topics(
    *, session: Session, user_id: uuid.UUID
) -> list[TrendingTopic]:
    """Get the most recent batch of trending topics for a user."""
    # 1. Find MAX(scraped_at) for this user
    max_scraped_at = session.exec(
        select(func.max(TrendingTopic.scraped_at)).where(
            TrendingTopic.user_id == user_id
        )
    ).first()

    if not max_scraped_at:
        return []

    # 2. Return topics from that batch
    stmt = (
        select(TrendingTopic)
        .where(
            TrendingTopic.user_id == user_id, TrendingTopic.scraped_at == max_scraped_at
        )
        .order_by(TrendingTopic.post_count.desc().nulls_last())  # type: ignore
    )

    return list(session.exec(stmt).all())
