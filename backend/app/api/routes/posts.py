import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status as http_status

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    Message,
    Post,
    PostCreate,
    PostPublic,
    PostsPublic,
    PostUpdate,
    SocialAccount,
)
from app.services.linkedin_posts import LinkedInPostClient, LinkedInPostError
from sqlmodel import select

router = APIRouter(prefix="/posts", tags=["posts"])

_linkedin_client = LinkedInPostClient()


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
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error retrieving posts: {str(exc)}",
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
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    
    # Check permissions: user must own the post or be a superuser
    if post.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to access this post",
        )

    return enrich_post_with_author(post, current_user)


@router.post("/", response_model=PostPublic, status_code=http_status.HTTP_201_CREATED)
async def create_post(
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
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="scheduled_at is required when status is 'scheduled'",
            )

        post = crud.create_post(
            session=session,
            post_in=post_in,
            owner_id=current_user.id,
        )

        # If this is a LinkedIn post published immediately, mirror it to LinkedIn
        if post.platform == "linkedin" and post.status == "published":
            # Find the user's LinkedIn social account to get external_user_id
            account = session.exec(
                select(SocialAccount).where(
                    SocialAccount.user_id == current_user.id,
                    SocialAccount.platform == "linkedin",
                )
            ).first()

            if not account or not account.external_user_id:
                # Mark as failed and surface a clear error
                post = crud.update_post(
                    session=session,
                    db_post=post,
                    post_in=PostUpdate(status="failed"),
                )
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="LinkedIn account not fully connected. Please reconnect LinkedIn and try again.",
                )

            try:
                linkedin_post_urn = await _linkedin_client.create_text_post(
                    user_id=str(current_user.id),
                    linkedin_person_id=account.external_user_id,
                    content=post.content,
                )
            except LinkedInPostError as e:
                # Mark local post as failed when LinkedIn rejects it
                post = crud.update_post(
                    session=session,
                    db_post=post,
                    post_in=PostUpdate(status="failed"),
                )
                raise e
            except Exception as e:
                post = crud.update_post(
                    session=session,
                    db_post=post,
                    post_in=PostUpdate(status="failed"),
                )
                raise HTTPException(
                    status_code=http_status.HTTP_502_BAD_GATEWAY,
                    detail=f"Unexpected error publishing to LinkedIn: {str(e)}",
                )

            # Persist external post id directly on the model
            post.external_post_id = linkedin_post_urn
            session.add(post)
            session.commit()
            session.refresh(post)

        return enrich_post_with_author(post, current_user)
    except ValueError as e:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error creating post: {str(e)}",
        )


@router.patch("/{post_id}", response_model=PostPublic)
async def update_post(
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
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    
    # Check permissions: user must own the post or be a superuser
    if db_post.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to update this post",
        )

    try:
        # Validate business rules if status is being updated
        if post_in.status == "scheduled":
            # Check if scheduled_at is provided or already exists
            if post_in.scheduled_at is None and db_post.scheduled_at is None:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="scheduled_at is required when status is 'scheduled'",
                )

        # If this is a LinkedIn post and content is being updated, mirror change
        if (
            db_post.platform == "linkedin"
            and db_post.external_post_id
            and post_in.content is not None
        ):
            try:
                await _linkedin_client.update_text_post(
                    user_id=str(current_user.id),
                    linkedin_post_urn=db_post.external_post_id,
                    content=post_in.content,
                )
            except LinkedInPostError as e:
                raise e
            except Exception as e:
                raise HTTPException(
                    status_code=http_status.HTTP_502_BAD_GATEWAY,
                    detail=f"Unexpected error updating LinkedIn post: {str(e)}",
                )

        db_post = crud.update_post(session=session, db_post=db_post, post_in=post_in)
        return enrich_post_with_author(db_post, current_user)
    except ValueError as e:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error updating post: {str(e)}",
        )


@router.delete("/{post_id}", response_model=Message)
async def delete_post(
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
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Post not found"
        )
    
    # Check permissions: user must own the post or be a superuser
    if post.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to delete this post",
        )

    try:
        # If this is a LinkedIn post with an external id, delete it from LinkedIn as well.
        if post.platform == "linkedin" and post.external_post_id:
            try:
                await _linkedin_client.delete_post(
                    user_id=str(current_user.id),
                    linkedin_post_urn=post.external_post_id,
                )
            except LinkedInPostError:
                # Ignore LinkedIn-specific errors on delete to keep operation idempotent
                pass
            except Exception:
                # Swallow unexpected LinkedIn errors as well; local delete should still succeed
                pass

        crud.delete_post(session=session, post_id=post_id)
        return Message(message="Post deleted successfully")
    except Exception as e:
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting post: {str(e)}",
        )
