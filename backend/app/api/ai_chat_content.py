from fastapi import HTTPException, status

from app.models import ChatMessageRequest
from app.services.ai_image_utils import sanitize_image_urls


def _validate_observation_content(
    *, body: ChatMessageRequest, message_text: str
) -> None:
    if body.observation is not None and body.images:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Browser observation cannot be combined with image attachments",
        )
    if body.observation is not None and not message_text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A question is required for browser observation",
        )


def _validate_nonempty_chat(*, message_text: str, clean_images: list[str]) -> None:
    if not message_text and not clean_images:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Message content or at least one image is required",
        )


def validate_chat_content(*, body: ChatMessageRequest) -> tuple[str, list[str]]:
    message_text = body.message.strip()
    _validate_observation_content(body=body, message_text=message_text)
    clean_images = sanitize_image_urls(images=body.images)
    if body.observation is None:
        _validate_nonempty_chat(message_text=message_text, clean_images=clean_images)
    return message_text, clean_images
