import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlmodel import Session

from app.api.deps import CurrentUser, SessionDep
from app.services.access import get_persona_role, has_min_role
from app.services.browser.manager import BrowserManager

router = APIRouter(prefix="/auth/x", tags=["auth"])


class XStatusResponse(BaseModel):
    status: str  # "connected" or "disconnected"


def _require_persona_role(
    *,
    session: Session,
    user_id: uuid.UUID,
    persona_id: uuid.UUID,
    minimum: str | None = None,
) -> str:
    role = get_persona_role(
        session=session,
        persona_id=persona_id,
        user_id=user_id,
    )
    if not role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
    if minimum and not has_min_role(role=role, minimum=minimum):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Not enough permissions (requires {minimum} role)",
        )
    return role


@router.get("/status", response_model=XStatusResponse)
def x_status(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    persona_id: uuid.UUID = Query(...),
) -> Any:
    """Check if the X account is connected for the persona."""
    _require_persona_role(
        session=session,
        user_id=current_user.id,
        persona_id=persona_id,
    )

    manager = BrowserManager(brand_id=str(persona_id))
    is_connected = manager.session_exists("x")
    return XStatusResponse(status="connected" if is_connected else "disconnected")


@router.post("/connect")
def x_connect(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    persona_id: uuid.UUID = Query(...),
    force: bool = Query(False),
) -> Any:
    """Launch the headed browser for manual X.com login.

    This spins up a subprocess. Only members/admins of the persona can do this.
    """
    _require_persona_role(
        session=session,
        user_id=current_user.id,
        persona_id=persona_id,
        minimum="admin",
    )

    manager = BrowserManager(brand_id=str(persona_id))
    try:
        manager.start_login_subprocess(platform_name="x", force=force)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    return {"message": "X login browser launched successfully."}
