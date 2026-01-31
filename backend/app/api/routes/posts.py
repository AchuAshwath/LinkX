"""Posts API routes with LinkedIn integration."""

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.crud import create_post, delete_post, get_post, get_posts, update_post
from app.models import (
    Post,
    PostAuthor,
    PostCreate,
    PostPublic,
    PostsPublic,
    PostUpdate,
    SocialAccount,
    User,
)
from app.services.linkedin_posts import LinkedInPostClient, LinkedInPostError

router = APIRouter(prefix="/posts", tags=["posts"])


def _get_linkedin_account(
    *, session: SessionDep, user_id: uuid.UUID
) -> SocialAccount | None:
    """Get LinkedIn social account for a user if it exists."""
    statement = select(SocialAccount).where(
        SocialAccount.user_id == user_id,
        SocialAccount.platform == "linkedin",
    )
    return session.exec(statement).first()


def _get_user_details(*, session: SessionDep, user_id: uuid.UUID) -> User | None:
    """Get user details for author info."""
    return session.get(User, user_id)


def _build_post_author(*, user: User) -> PostAuthor:
    """Build PostAuthor from User."""
    return PostAuthor(
        name=user.full_name or user.email,
        username=user.email.split("@")[0],
        avatarUrl=None,  # Could be extended to support avatars
    )


def _post_to_public(*, post: Post, author: PostAuthor | None = None) -> PostPublic:
    """Convert Post model to PostPublic response."""
    return PostPublic(
        id=post.id,
        owner_id=post.owner_id,
        content=post.content,
        image_url=post.image_url,
        platform=post.platform,
        status=post.status,
        scheduled_at=post.scheduled_at,
        published_at=post.published_at,
        likes=post.likes,
        reposts=post.reposts,
        comments=post.comments,
        created_at=post.created_at,
        updated_at=post.updated_at,
        external_post_id=post.external_post_id,
        author=author,
    )


@router.get("", response_model=PostsPublic)
def read_posts(
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    status: str | None = None,
) -> Any:
    """
    Retrieve posts for the current user.

    Args:
        skip: Number of posts to skip (pagination)
        limit: Maximum number of posts to return
        status: Filter by status (draft, scheduled, published, failed)
    """
    posts, count = get_posts(
        session=session,
        owner_id=current_user.id,
        status=status,
        skip=skip,
        limit=limit,
    )

    # Get user details for author info
    user = _get_user_details(session=session, user_id=current_user.id)
    author = _build_post_author(user=user) if user else None

    return PostsPublic(
        data=[_post_to_public(post=post, author=author) for post in posts],
        count=count,
    )


@router.post("", response_model=PostPublic, status_code=status.HTTP_201_CREATED)
async def create_new_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_in: PostCreate,
) -> Any:
    """
    Create a new post.

    If status is 'published' and the user has LinkedIn connected,
    the post will be published to LinkedIn immediately.
    """
    # Create the post in the database
    post = create_post(session=session, post_in=post_in, owner_id=current_user.id)

    # If status is published, try to publish to LinkedIn
    if post_in.status == "published":
        linkedin_account = _get_linkedin_account(
            session=session, user_id=current_user.id
        )

        if linkedin_account and linkedin_account.external_user_id:
            try:
                client = LinkedInPostClient()
                external_post_id = await client.create_text_post(
                    user_id=str(current_user.id),
                    linkedin_person_id=linkedin_account.external_user_id,
                    content=post_in.content,
                )

                # Update post with external_post_id and published_at
                post.external_post_id = external_post_id
                post.published_at = datetime.now(timezone.utc)
                session.add(post)
                session.commit()
                session.refresh(post)

            except LinkedInPostError as e:
                # Don't fail the request, but mark as failed
                post.status = "failed"
                session.add(post)
                session.commit()
                session.refresh(post)
                # Could log this error for monitoring
                print(f"LinkedIn publish failed: {e.detail}")

    # Get user details for author info
    user = _get_user_details(session=session, user_id=current_user.id)
    author = _build_post_author(user=user) if user else None

    return _post_to_public(post=post, author=author)


@router.get("/{post_id}", response_model=PostPublic)
def read_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
) -> Any:
    """Get a specific post by ID."""
    post = get_post(session=session, post_id=post_id)

    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post not found",
        )

    if post.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )

    # Get user details for author info
    user = _get_user_details(session=session, user_id=post.owner_id)
    author = _build_post_author(user=user) if user else None

    return _post_to_public(post=post, author=author)


@router.put("/{post_id}", response_model=PostPublic)
async def update_existing_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
    post_in: PostUpdate,
) -> Any:
    """
    Update a post.

    If status is changed to 'published' and the user has LinkedIn connected,
    the post will be published to LinkedIn.
    """
    post = get_post(session=session, post_id=post_id)

    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post not found",
        )

    if post.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )

    # Check if we're transitioning to published status
    is_publishing = (
        post_in.status == "published"
        and post.status != "published"
        and not post.external_post_id  # Only publish if not already published
    )

    # Update the post
    post = update_post(session=session, db_post=post, post_in=post_in)

    # If publishing to LinkedIn
    if is_publishing:
        linkedin_account = _get_linkedin_account(
            session=session, user_id=current_user.id
        )

        if linkedin_account and linkedin_account.external_user_id:
            try:
                client = LinkedInPostClient()
                external_post_id = await client.create_text_post(
                    user_id=str(current_user.id),
                    linkedin_person_id=linkedin_account.external_user_id,
                    content=post.content,
                )

                # Update post with external_post_id and published_at
                post.external_post_id = external_post_id
                post.published_at = datetime.now(timezone.utc)
                session.add(post)
                session.commit()
                session.refresh(post)

            except LinkedInPostError as e:
                # Mark as failed but don't fail the request
                post.status = "failed"
                session.add(post)
                session.commit()
                session.refresh(post)
                print(f"LinkedIn publish failed: {e.detail}")

    # Get user details for author info
    user = _get_user_details(session=session, user_id=post.owner_id)
    author = _build_post_author(user=user) if user else None

    return _post_to_public(post=post, author=author)


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_existing_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
) -> None:
    """Delete a post."""
    post = get_post(session=session, post_id=post_id)

    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post not found",
        )

    if post.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )

    delete_post(session=session, post_id=post_id)
