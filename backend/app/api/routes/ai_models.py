"""Discovery of available models, separate from conversation mutation."""

from typing import Any

from fastapi import APIRouter

from app.core.config import settings
from app.models import AIModelsPublic
from app.services.ai_model_catalog import get_available_ai_models

router = APIRouter(prefix="/ai/threads", tags=["ai-threads"])


@router.get("/models", response_model=AIModelsPublic)
def list_ai_models() -> Any:
    """List available AI models from the proxy/backend with friendly labels."""
    configured_default = settings.AI_MODEL.removeprefix("openai/")
    models = get_available_ai_models(configured_default=configured_default)
    models.observation_model = settings.VISION_AI_MODEL.removeprefix("openai/")
    return models
