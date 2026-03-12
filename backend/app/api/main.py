from fastapi import APIRouter

from app.api.routes import (
    admin,
    items,
    linkedin,
    linkedin_auth,
    login,
    personas,
    posts,
    private,
    teams,
    users,
    utils,
)
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(items.router)
api_router.include_router(posts.router)
api_router.include_router(linkedin_auth.router)
api_router.include_router(linkedin.router)
api_router.include_router(personas.router)
api_router.include_router(teams.router)
api_router.include_router(admin.router)


if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
