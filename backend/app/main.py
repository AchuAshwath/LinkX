import asyncio
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager, suppress

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles

from app.api.main import api_router
from app.api.routes.docs import router as docs_router
from app.core.config import settings

logger = logging.getLogger(__name__)


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Manage application startup and shutdown lifecycle including background scheduler."""
    task = None
    if settings.SCHEDULER_ENABLED and settings.ENVIRONMENT != "testing":
        redis_client = None
        try:
            import redis

            redis_client = redis.from_url(settings.REDIS_URL)  # type: ignore[no-untyped-call]
        except Exception as exc:
            logger.debug("Redis unavailable for scheduler background loop: %s", exc)

        from app.services.scheduler import run_scheduler_background_loop

        task = asyncio.create_task(
            run_scheduler_background_loop(
                poll_interval_seconds=settings.SCHEDULER_POLL_INTERVAL_SECONDS,
                redis_client=redis_client,
            )
        )

    yield

    if task is not None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


if settings.SENTRY_DSN and settings.ENVIRONMENT != "local":
    sentry_sdk.init(dsn=str(settings.SENTRY_DSN), enable_tracing=True)

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=None,  # Disable default docs to use custom
    redoc_url=None,  # Disable redoc
    generate_unique_id_function=custom_generate_unique_id,
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def sanitize_observation_validation_error(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Do not echo transient frame data in observation validation responses."""
    details = []
    for error in exc.errors():
        sanitized = dict(error)
        location = error.get("loc", ())
        if "observation" in location or location == ("body",):
            sanitized.pop("input", None)
            sanitized.pop("ctx", None)
        details.append(sanitized)
    return JSONResponse(status_code=422, content={"detail": details})


# Mount static files for media uploads
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# Add custom docs router (before CORS to ensure it works)
app.include_router(docs_router)

# Set all CORS enabled origins
if settings.all_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.all_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api_router, prefix=settings.API_V1_STR)
