from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.core.redis import get_redis
from app.models import SocialAccount

router = APIRouter(prefix="/linkedin", tags=["linkedin"])


@router.get("/status")
def linkedin_status(current_user: CurrentUser, session: SessionDep) -> dict[str, Any]:
    """
    Minimal connected-status endpoint for the frontend Social Accounts page.
    Uses Redis for token validity and Postgres for profile metadata.
    """
    user_id = str(current_user.id)
    now = time.time()

    # Token info from Redis
    token_payload: dict[str, Any] | None = None
    try:
        r = get_redis()
        raw = r.get(f"linkedin:token:{user_id}")
        if raw:
            token_payload = json.loads(raw)  # type: ignore[arg-type]
    except Exception:
        token_payload = None

    expires_at = None
    needs_reconnect = False
    connected = False
    if token_payload and "expires_at" in token_payload:
        expires_at = token_payload.get("expires_at")
        try:
            needs_reconnect = (
                float(expires_at) <= now if expires_at is not None else False
            )
        except Exception:
            needs_reconnect = False
        connected = not needs_reconnect

    # Profile metadata from Postgres
    account = session.exec(
        select(SocialAccount).where(
            SocialAccount.user_id == current_user.id,
            SocialAccount.platform == "linkedin",
        )
    ).first()

    profile = None
    if account:
        profile = {
            "display_name": account.display_name,
            "email": account.email,
            "profile_picture_url": account.profile_picture_url,
        }

    return {
        "connected": connected,
        "needs_reconnect": needs_reconnect,
        "expires_at": expires_at,
        "profile": profile,
    }
