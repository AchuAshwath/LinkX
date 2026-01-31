"""Custom Swagger UI with LinkX branding."""

from fastapi import APIRouter, Request
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse

from app.core.config import settings

router = APIRouter(tags=["docs"])


@router.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html(request: Request) -> HTMLResponse:
    """Custom Swagger UI with LinkX branding."""
    # Use frontend URL for LinkX favicon
    favicon_url = f"{settings.FRONTEND_HOST}/assets/images/LinkX-icon.svg"
    return get_swagger_ui_html(
        openapi_url=f"{settings.API_V1_STR}/openapi.json",
        title=f"{settings.PROJECT_NAME} - API Documentation",
        swagger_favicon_url=favicon_url,
        swagger_ui_parameters={
            "deepLinking": True,
            "displayOperationId": True,
            "defaultModelsExpandDepth": 1,
            "defaultModelExpandDepth": 1,
            "defaultModelRendering": "example",
            "displayRequestDuration": True,
            "docExpansion": "list",
            "filter": True,
            "operationsSorter": "alpha",
            "showExtensions": True,
            "showCommonExtensions": True,
            "tryItOutEnabled": True,
            "supportedSubmitMethods": [
                "get",
                "put",
                "post",
                "delete",
                "options",
                "head",
                "patch",
                "trace",
            ],
            "validatorUrl": None,
        },
    )
