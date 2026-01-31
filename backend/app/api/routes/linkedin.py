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
    Connected-status endpoint for the frontend Social Accounts page.
    - Token validity comes from Redis (source of truth for "can call LinkedIn API").
    - Profile metadata comes from Postgres (SocialAccount); survives Redis/restarts.
    - connected: True only when we have a valid (non-expired) token in Redis.
    - needs_reconnect: True when user has linked LinkedIn (SocialAccount exists)
      but token is missing or expired, so they should re-authorize.
    """
    user_id = str(current_user.id)
    now = time.time()

    # Token from Redis (graceful if Redis down or key missing)
    token_payload: dict[str, Any] | None = None
    try:
        r = get_redis()
        raw = r.get(f"linkedin:token:{user_id}")
        if raw:
            token_payload = json.loads(raw)  # type: ignore[arg-type]
    except Exception:
        token_payload = None

    expires_at = None
    connected = False
    if token_payload and "expires_at" in token_payload:
        expires_at = token_payload.get("expires_at")
        try:
            token_valid = (
                expires_at is not None and float(expires_at) > now
            )
        except (TypeError, ValueError):
            token_valid = False
        connected = token_valid

    # Profile from Postgres (authoritative for "has ever linked LinkedIn")
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

    # needs_reconnect: linked before (account exists) but no valid token
    needs_reconnect = (not connected) and (account is not None)

    return {
        "connected": connected,
        "needs_reconnect": needs_reconnect,
        "expires_at": expires_at,
        "profile": profile,
    }
