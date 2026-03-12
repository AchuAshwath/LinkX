from __future__ import annotations

import json
import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.core.redis import get_redis
from app.models import SocialAccount
from app.services.access import get_persona_role, has_min_role

router = APIRouter(prefix="/linkedin", tags=["linkedin"])


def _redis_token_key(*, persona_id: uuid.UUID) -> str:
    return f"linkedin:token:{persona_id}"


@router.get("/status")
def linkedin_status(
    current_user: CurrentUser,
    session: SessionDep,
    persona_id: uuid.UUID,
) -> dict[str, Any]:
    """
    Connected-status endpoint for the frontend Social Accounts page.
    - Token validity comes from Redis (source of truth for "can call LinkedIn API").
    - Profile metadata comes from Postgres (SocialAccount); survives Redis/restarts.
    - connected: True only when we have a valid (non-expired) token in Redis.
    - needs_reconnect: True when user has linked LinkedIn (SocialAccount exists)
      but token is missing or expired, so they should re-authorize.
    """
    role = get_persona_role(
        session=session,
        persona_id=persona_id,
        user_id=current_user.id,
    )
    if not role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )

    now = time.time()

    # Token from Redis (graceful if Redis down or key missing)
    token_payload: dict[str, Any] | None = None
    try:
        r = get_redis()
        raw = r.get(_redis_token_key(persona_id=persona_id))
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

    # Profile from Postgres (authoritative for "has ever linked LinkedIn")
    account = session.exec(
        select(SocialAccount).where(
            SocialAccount.persona_id == persona_id,
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


@router.delete("/disconnect")
def linkedin_disconnect(
    current_user: CurrentUser,
    session: SessionDep,
    persona_id: uuid.UUID,
) -> dict[str, Any]:
    """
    Disconnect LinkedIn for a persona.
    - Deletes token from Redis (best-effort).
    - Deletes persisted SocialAccount row for LinkedIn.
    """
    role = get_persona_role(
        session=session,
        persona_id=persona_id,
        user_id=current_user.id,
    )
    if not role or not has_min_role(role=role, minimum="admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )

    # Best-effort delete token keys from Redis
    try:
        r = get_redis()
        r.delete(_redis_token_key(persona_id=persona_id))
        # Legacy key (older flows)
        r.delete(f"linkedin:token:{current_user.id}")
        r.delete(f"linkedin:profile:{persona_id}")
        r.delete(f"linkedin:profile:{current_user.id}")
    except Exception:
        pass

    account = session.exec(
        select(SocialAccount).where(
            SocialAccount.persona_id == persona_id,
            SocialAccount.platform == "linkedin",
        )
    ).first()
    if account is not None:
        session.delete(account)
        session.commit()

    return {"ok": True}
