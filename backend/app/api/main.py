from fastapi import APIRouter

from app.api.routes import (
    admin,
    ai_threads,
    items,
    linkedin,
    linkedin_auth,
    login,
    posts,
    private,
    trending,
    users,
    utils,
    x_auth,
)
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(items.router)
api_router.include_router(posts.router)
api_router.include_router(ai_threads.router)
api_router.include_router(linkedin_auth.router)
api_router.include_router(linkedin.router)
api_router.include_router(admin.router)
api_router.include_router(trending.router)
api_router.include_router(x_auth.router)


if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
