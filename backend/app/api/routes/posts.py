import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import Message, Post, PostCreate, PostPublic, PostsPublic, PostUpdate

router = APIRouter(prefix="/posts", tags=["posts"])


def enrich_post_with_author(post: Post, user: Any) -> PostPublic:
    """Enrich post with author information."""
    post_dict = post.model_dump()
    # Extract username from email (part before @)
    username = user.email.split("@")[0] if user.email else "user"
    post_dict["author"] = {
        "name": user.full_name or user.email or "Unknown User",
        "username": username,
        "avatarUrl": None,  # TODO: Add avatar_url to User model if needed
    }
    return PostPublic(**post_dict)


@router.get("/", response_model=PostsPublic)
def read_posts(
    session: SessionDep,
    current_user: CurrentUser,
    status: str | None = Query(
        None, description="Filter by status: draft, scheduled, published, failed"
    ),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
) -> Any:
    """
    Retrieve posts for current user.
    
    - **status**: Optional filter by post status
    - **skip**: Number of posts to skip (for pagination)
    - **limit**: Maximum number of posts to return (1-100)
    """
    try:
        posts, count = crud.get_posts(
            session=session,
            owner_id=current_user.id,
            status=status,
            skip=skip,
            limit=limit,
        )

        # Enrich with author info
        enriched_posts = [
            enrich_post_with_author(post, current_user) for post in posts
        ]

        return PostsPublic(data=enriched_posts, count=count)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error retrieving posts: {str(e)}",
        )


@router.get("/{post_id}", response_model=PostPublic)
def read_post(
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
) -> Any:
    """
    Get a specific post by ID.
    
    - **post_id**: UUID of the post to retrieve
    """
    post = crud.get_post(session=session, post_id=post_id)
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    
    # Check permissions: user must own the post or be a superuser
    if post.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to access this post",
        )

    return enrich_post_with_author(post, current_user)


@router.post("/", response_model=PostPublic, status_code=status.HTTP_201_CREATED)
def create_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_in: PostCreate,
) -> Any:
    """
    Create a new post.
    
    - **content**: Post content (1-3000 characters, required)
    - **image_url**: Optional image URL
    - **platform**: Platform to post to (linkedin, x, all)
    - **status**: Post status (draft, scheduled, published, failed)
    - **scheduled_at**: Required if status is 'scheduled'
    """
    try:
        # Validate business rules
        if post_in.status == "scheduled" and post_in.scheduled_at is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="scheduled_at is required when status is 'scheduled'",
            )

        post = crud.create_post(
            session=session,
            post_in=post_in,
            owner_id=current_user.id,
        )
        return enrich_post_with_author(post, current_user)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error creating post: {str(e)}",
        )


@router.patch("/{post_id}", response_model=PostPublic)
def update_post(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
    post_in: PostUpdate,
) -> Any:
    """
    Update a post.
    
    - **post_id**: UUID of the post to update
    - All fields are optional - only provided fields will be updated
    """
    db_post = crud.get_post(session=session, post_id=post_id)
    if not db_post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    
    # Check permissions: user must own the post or be a superuser
    if db_post.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to update this post",
        )

    try:
        # Validate business rules if status is being updated
        if post_in.status == "scheduled":
            # Check if scheduled_at is provided or already exists
            if post_in.scheduled_at is None and db_post.scheduled_at is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="scheduled_at is required when status is 'scheduled'",
                )

        db_post = crud.update_post(session=session, db_post=db_post, post_in=post_in)
        return enrich_post_with_author(db_post, current_user)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error updating post: {str(e)}",
        )


@router.delete("/{post_id}", response_model=Message)
def delete_post(
    session: SessionDep,
    current_user: CurrentUser,
    post_id: uuid.UUID,
) -> Message:
    """
    Delete a post.
    
    - **post_id**: UUID of the post to delete
    """
    post = crud.get_post(session=session, post_id=post_id)
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    
    # Check permissions: user must own the post or be a superuser
    if post.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to delete this post",
        )

    try:
        crud.delete_post(session=session, post_id=post_id)
        return Message(message="Post deleted successfully")
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting post: {str(e)}",
        )
