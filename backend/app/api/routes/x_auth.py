from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.services.browser.manager import BrowserManager

router = APIRouter(prefix="/auth/x", tags=["auth"])


class XStatusResponse(BaseModel):
    status: str  # "connected" or "disconnected"


@router.get("/status", response_model=XStatusResponse)
def x_status(
    *,
    current_user: CurrentUser,
) -> Any:
    """Check if the X account is connected for the current user."""
    manager = BrowserManager(brand_id=str(current_user.id))
    is_connected = manager.session_exists("x")
    return XStatusResponse(status="connected" if is_connected else "disconnected")


@router.post("/connect")
def x_connect(
    *,
    current_user: CurrentUser,
    force: bool = Query(False),
) -> Any:
    """Launch the headed browser for manual X.com login for current user."""
    manager = BrowserManager(brand_id=str(current_user.id))
    try:
        manager.start_login_subprocess(platform_name="x", force=force)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    return {"message": "X login browser launched successfully."}
