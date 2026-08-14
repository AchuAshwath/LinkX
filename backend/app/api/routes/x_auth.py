from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.services.browser.manager import BrowserManager

router = APIRouter(prefix="/auth/x", tags=["auth"])


class XStatusPublic(BaseModel):
    status: str  # "connected" or "disconnected"
    session_dir: str
    cookie_files_found: bool
    login_method: str = "headed_chrome_automation"


class XVerifyResponse(BaseModel):
    connected: bool
    authenticated: bool
    message: str
    url: str | None = None


@router.get("/status", response_model=XStatusPublic)
def x_status(
    *,
    current_user: CurrentUser,
) -> Any:
    """Check if the X account cookie session is present on disk for the current user."""
    manager = BrowserManager(user_id=str(current_user.id))
    is_connected = manager.session_exists("x")
    session_dir_path = str(manager.get_session_dir_path("x"))
    return XStatusPublic(
        status="connected" if is_connected else "disconnected",
        session_dir=session_dir_path,
        cookie_files_found=is_connected,
        login_method="headed_chrome_automation",
    )


@router.post("/verify", response_model=XVerifyResponse)
async def x_verify(
    *,
    current_user: CurrentUser,
) -> Any:
    """Run live headless verification against X.com to confirm cookies are valid and feed loads."""
    manager = BrowserManager(user_id=str(current_user.id))
    result = await manager.verify_session(platform_name="x")
    return XVerifyResponse(**result)


@router.post("/connect")
def x_connect(
    *,
    current_user: CurrentUser,
    force: bool = Query(False),
) -> Any:
    """Launch the headed Chrome browser on the host machine for manual X.com login."""
    manager = BrowserManager(user_id=str(current_user.id))
    try:
        manager.start_login_subprocess(platform_name="x", force=force)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    return {
        "message": "Headed Chrome browser launched for X.com login. Please log in and close the browser.",
        "session_dir": str(manager.get_session_dir_path("x")),
    }
