import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, col, delete, func, select

from app.core.security import get_password_hash, verify_password
from app.models import (
    ChatThread,
    ChatThreadCreate,
    ChatThreadUpdate,
    Item,
    ItemCreate,
    Post,
    PostCreate,
    PostUpdate,
    SocialAccount,
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
        update={"owner_id": owner_id},
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
                update_data["published_at"] = datetime.now(timezone.utc)

    db_post.sqlmodel_update(update_data)
    db_post.updated_at = datetime.now(timezone.utc)
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
    *, session: Session, user_id: uuid.UUID, limit: int = 3
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

    # 2. Return topics from that batch (within 15 minutes of latest scrape)
    window_start = max_scraped_at - timedelta(minutes=15)
    stmt = (
        select(TrendingTopic)
        .where(
            TrendingTopic.user_id == user_id,
            TrendingTopic.scraped_at >= window_start,
        )
        .order_by(
            col(TrendingTopic.post_count).desc().nulls_last(),
            col(TrendingTopic.scraped_at).desc(),
        )
        .limit(limit)
    )
    return list(session.exec(stmt).all())


def get_trending_tweets_for_topic(
    *, session: Session, topic_id: uuid.UUID, limit: int = 10
) -> list[TrendingTweet]:
    """Get extracted tweets for a specific trending topic."""
    stmt = (
        select(TrendingTweet)
        .where(TrendingTweet.topic_id == topic_id)
        .order_by(
            col(TrendingTweet.likes).desc().nulls_last(),
            col(TrendingTweet.created_at).desc(),
        )
        .limit(limit)
    )
    return list(session.exec(stmt).all())


def get_latest_published_post(
    *, session: Session, user_id: uuid.UUID, platform: str | None = None
) -> Post | None:
    """Get the most recently published post for a user."""
    stmt = select(Post).where(
        Post.owner_id == user_id,
        Post.status == "published",
    )
    if platform:
        if platform == "linkx":
            stmt = stmt.where(col(Post.platform).in_(["linkx", "all", "x", "linkedin"]))
        else:
            stmt = stmt.where(Post.platform == platform)

    stmt = stmt.order_by(col(Post.published_at).desc().nulls_last())
    return session.exec(stmt).first()


def get_social_account(
    *, session: Session, user_id: uuid.UUID, platform: str
) -> SocialAccount | None:
    """Get a connected social account record for a user."""
    stmt = select(SocialAccount).where(
        SocialAccount.user_id == user_id,
        SocialAccount.platform == platform,
    )
    return session.exec(stmt).first()


# --- AI Chat Threads ---


def create_chat_thread(
    *, session: Session, thread_in: ChatThreadCreate, owner_id: uuid.UUID
) -> ChatThread:
    """Create a new chat thread, auto-generating title and initial transcript if prompt provided."""
    prompt_text = thread_in.prompt.strip() if thread_in.prompt else None
    if prompt_text:
        lines = [line.strip() for line in prompt_text.splitlines() if line.strip()]
        first_line = lines[0] if lines else "New conversation"
        title = first_line[:60] + ("…" if len(first_line) > 60 else "")
        transcript: dict[str, Any] = {
            "messages": [
                {
                    "id": f"msg_{uuid.uuid4().hex[:12]}",
                    "role": "user",
                    "parts": [{"type": "text", "text": prompt_text}],
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            ]
        }
        message_count = 1
    else:
        title = "New conversation"
        transcript = {"messages": []}
        message_count = 0

    db_thread = ChatThread(
        owner_id=owner_id,
        title=title,
        origin=thread_in.origin,
        post_id=thread_in.post_id,
        topic_keyword=thread_in.topic_keyword,
        message_count=message_count,
        is_archived=False,
        transcript=transcript,
    )
    session.add(db_thread)
    session.commit()
    session.refresh(db_thread)
    return db_thread


def get_chat_thread(*, session: Session, thread_id: uuid.UUID) -> ChatThread | None:
    """Get a chat thread by ID."""
    return session.get(ChatThread, thread_id)


def get_chat_threads(
    *,
    session: Session,
    owner_id: uuid.UUID,
    is_archived: bool | None = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[ChatThread], int]:
    """Get chat threads for a user with optional archive filter."""
    statement = select(ChatThread).where(ChatThread.owner_id == owner_id)
    count_statement = (
        select(func.count())
        .select_from(ChatThread)
        .where(ChatThread.owner_id == owner_id)
    )

    if is_archived is not None:
        statement = statement.where(ChatThread.is_archived == is_archived)
        count_statement = count_statement.where(ChatThread.is_archived == is_archived)

    statement = (
        statement.order_by(col(ChatThread.updated_at).desc().nulls_last())
        .offset(skip)
        .limit(limit)
    )
    count = session.exec(count_statement).one()
    threads = list(session.exec(statement).all())
    return threads, count


def update_chat_thread(
    *, session: Session, db_thread: ChatThread, thread_in: ChatThreadUpdate
) -> ChatThread:
    """Update chat thread metadata (title, archive status)."""
    update_data = thread_in.model_dump(exclude_unset=True)
    if "title" in update_data and update_data["title"] is not None:
        trimmed_title = update_data["title"].strip()
        if not trimmed_title:
            raise ValueError("Title cannot be empty or whitespace only")
        update_data["title"] = trimmed_title

    db_thread.sqlmodel_update(update_data)
    db_thread.updated_at = datetime.now(timezone.utc)
    session.add(db_thread)
    session.commit()
    session.refresh(db_thread)
    return db_thread


def delete_chat_thread(*, session: Session, thread_id: uuid.UUID) -> None:
    """Delete a chat thread."""
    thread = session.get(ChatThread, thread_id)
    if thread:
        session.delete(thread)
        session.commit()


def append_message_to_transcript(
    *, session: Session, db_thread: ChatThread, message: dict[str, Any]
) -> ChatThread:
    """Append a message to the thread's JSONB transcript and update message count."""
    current_transcript = dict(db_thread.transcript or {})
    messages = list(current_transcript.get("messages", []))
    messages.append(message)
    current_transcript["messages"] = messages

    db_thread.transcript = current_transcript
    db_thread.message_count = len(messages)
    db_thread.updated_at = datetime.now(timezone.utc)
    session.add(db_thread)
    session.commit()
    session.refresh(db_thread)
    return db_thread
