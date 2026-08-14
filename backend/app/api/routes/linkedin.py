from __future__ import annotations

import json
import logging
import time
from typing import Any

from fastapi import APIRouter
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.core.redis import get_redis
from app.models import SocialAccount
from app.services.linkedin_posts import linkedin_token_redis_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/linkedin", tags=["linkedin"])


@router.get("/status")
def linkedin_status(
    *,
    current_user: CurrentUser,
    session: SessionDep,
) -> dict[str, Any]:
    """
    Connected-status endpoint for LinkedIn account.
    - Token validity comes from Redis (source of truth for API calls).
    - Profile metadata comes from Postgres (SocialAccount).
    - connected: True only when we have a valid (non-expired) token in Redis.
    - needs_reconnect: True when user linked LinkedIn but token is missing or expired.
    """
    now = time.time()

    # Token from Redis (graceful if Redis down or key missing)
    token_payload: dict[str, Any] | None = None
    try:
        r = get_redis()
        raw = r.get(linkedin_token_redis_key(user_id=current_user.id))
        if raw:
            token_payload = json.loads(raw)  # type: ignore[arg-type]
    except Exception:
        token_payload = None

    expires_at = None
    connected = False
    if token_payload and "expires_at" in token_payload:
        expires_at = token_payload.get("expires_at")
        try:
            token_valid = expires_at is not None and float(expires_at) > now
        except (TypeError, ValueError):
            token_valid = False
        connected = token_valid

    # Profile from Postgres
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

    needs_reconnect = (not connected) and (account is not None)

    return {
        "connected": connected,
        "needs_reconnect": needs_reconnect,
        "expires_at": expires_at,
        "profile": profile,
    }


@router.delete("/disconnect")
def linkedin_disconnect(
    *,
    current_user: CurrentUser,
    session: SessionDep,
) -> dict[str, Any]:
    """
    Disconnect LinkedIn for the current user.
    - Deletes token from Redis (best-effort).
    - Deletes persisted SocialAccount row for LinkedIn.
    """
    try:
        r = get_redis()
        r.delete(linkedin_token_redis_key(user_id=current_user.id))
    except Exception:
        logger.warning(
            "LinkedIn disconnect: Redis delete failed (best-effort); continuing",
            exc_info=True,
        )

    account = session.exec(
        select(SocialAccount).where(
            SocialAccount.user_id == current_user.id,
            SocialAccount.platform == "linkedin",
        )
    ).first()
    if account is not None:
        session.delete(account)
        session.commit()

    return {"ok": True}
