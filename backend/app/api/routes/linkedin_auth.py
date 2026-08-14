from __future__ import annotations

import json
import logging
import secrets
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.core.redis import get_redis
from app.models import SocialAccount

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/linkedin", tags=["auth"])


@dataclass(frozen=True)
class LinkedInToken:
    access_token: str
    expires_in: int
    expires_at: float
    token_type: str


_STATE_TTL_SECONDS = 15 * 60
_state_store: dict[str, tuple[str, float]] = {}  # in-memory fallback
_token_store: dict[str, LinkedInToken] = {}  # in-memory fallback
_profile_store: dict[str, dict[str, Any]] = {}  # in-memory fallback
_redis_fallback_warning_logged = False


def _require_linkedin_config() -> tuple[str, str, str]:
    if not settings.LINKEDIN_CLIENT_ID or not settings.LINKEDIN_CLIENT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LinkedIn OAuth is not configured on the server",
        )
    redirect_uri = (settings.LINKEDIN_REDIRECT_URI or "").strip().rstrip("/")
    return (
        settings.LINKEDIN_CLIENT_ID,
        settings.LINKEDIN_CLIENT_SECRET,
        redirect_uri,
    )


def _cleanup_state_store(now: float) -> None:
    expired = [k for k, (_, exp) in _state_store.items() if exp <= now]
    for k in expired:
        _state_store.pop(k, None)


def _cleanup_token_store(now: float) -> None:
    expired_users = [k for k, v in _token_store.items() if v.expires_at <= now]
    for k in expired_users:
        _token_store.pop(k, None)
        _profile_store.pop(k, None)


def _redis_state_key(state: str) -> str:
    return f"linkedin:oauth_state:{state}"


def _redis_token_key(user_id: str) -> str:
    return f"linkedin:token:{user_id}"


def _redis_profile_key(user_id: str) -> str:
    return f"linkedin:profile:{user_id}"


def _mask_redirect_uri(uri: str) -> str:
    if not uri or len(uri) < 20:
        return "(not set or too short)"
    return uri[:30] + "..." + uri[-20:] if len(uri) > 50 else uri


@router.get("/config-check")
def linkedin_config_check() -> dict[str, Any]:
    """Return LinkedIn OAuth config status."""
    redirect_uri = (settings.LINKEDIN_REDIRECT_URI or "").strip().rstrip("/")
    return {
        "configured": bool(
            settings.LINKEDIN_CLIENT_ID and settings.LINKEDIN_CLIENT_SECRET
        ),
        "has_client_id": bool(settings.LINKEDIN_CLIENT_ID),
        "has_client_secret": bool(settings.LINKEDIN_CLIENT_SECRET),
        "redirect_uri_masked": _mask_redirect_uri(redirect_uri),
        "redirect_uri_length": len(redirect_uri),
    }


@router.get("/authorize")
def linkedin_authorize(
    current_user: CurrentUser,
) -> dict[str, str]:
    """Start LinkedIn OAuth for current user."""
    global _redis_fallback_warning_logged

    client_id, _client_secret, redirect_uri = _require_linkedin_config()

    now = time.time()
    _cleanup_state_store(now)
    _cleanup_token_store(now)

    state = secrets.token_urlsafe(32)
    user_id = str(current_user.id)
    try:
        r = get_redis()
        r.setex(
            _redis_state_key(state),
            _STATE_TTL_SECONDS,
            json.dumps({"user_id": user_id}),
        )
    except Exception:
        if not _redis_fallback_warning_logged:
            logger.warning(
                "Redis unavailable for OAuth state store; falling back to in-memory storage."
            )
            _redis_fallback_warning_logged = True
        _state_store[state] = (user_id, now + _STATE_TTL_SECONDS)

    scope = settings.LINKEDIN_SCOPES.strip()
    authorize_url = "https://www.linkedin.com/oauth/v2/authorization?" + urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "state": state,
            "scope": scope,
        }
    )
    return {"authorize_url": authorize_url}


def _frontend_redirect(
    path: str = "/accounts", linkedin: str = "error"
) -> RedirectResponse:
    base = settings.FRONTEND_HOST.rstrip("/")
    url = f"{base}{path}?linkedin={linkedin}"
    return RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)


@router.get("/callback")
async def linkedin_callback(
    session: SessionDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
) -> Any:
    """OAuth callback endpoint configured in LinkedIn Developer Portal."""
    global _redis_fallback_warning_logged

    if error:
        logger.warning(
            "LinkedIn OAuth callback: error=%s description=%s",
            error,
            error_description or "",
        )
        return _frontend_redirect()

    if not code or not state:
        return _frontend_redirect()

    now = time.time()
    _cleanup_state_store(now)
    user_id: str | None = None
    try:
        r = get_redis()
        raw_state = r.get(_redis_state_key(state))
        raw_value: str | None = None
        if isinstance(raw_state, bytes):
            raw_value = raw_state.decode("utf-8")
        elif isinstance(raw_state, str):
            raw_value = raw_state
        if raw_value:
            payload = json.loads(raw_value)
            user_id = str(payload.get("user_id")) if payload.get("user_id") else None
            r.delete(_redis_state_key(state))
    except Exception as e:
        logger.warning("LinkedIn OAuth callback: Redis state read failed: %s", e)
        user_id = None

    if not user_id:
        state_entry = _state_store.pop(state, None)
        if state_entry:
            user_id, _expires_at = state_entry

    if not user_id:
        logger.warning("LinkedIn OAuth callback: state not found.")
        return _frontend_redirect()

    try:
        user_uuid = uuid.UUID(str(user_id))
    except (TypeError, ValueError):
        return _frontend_redirect()

    client_id, client_secret, redirect_uri = _require_linkedin_config()

    token_url = "https://www.linkedin.com/oauth/v2/accessToken"
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "client_secret": client_secret,
    }

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.post(
                token_url,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        except httpx.RequestError as exc:
            logger.warning("LinkedIn token exchange request failed: %s", exc)
            return _frontend_redirect()

        if resp.status_code >= 400:
            logger.warning(
                "LinkedIn token exchange error %s: %s", resp.status_code, resp.text
            )
            return _frontend_redirect()

        token_data = resp.json()
        access_token = token_data.get("access_token")
        expires_in = token_data.get("expires_in", 5184000)
        token_type = token_data.get("token_type", "bearer")

        if not access_token:
            return _frontend_redirect()

        token = LinkedInToken(
            access_token=str(access_token),
            expires_in=int(expires_in),
            expires_at=now + float(expires_in),
            token_type=str(token_type),
        )

        try:
            r = get_redis()
            r.setex(
                _redis_token_key(user_id),
                max(token.expires_in, 60),
                json.dumps(
                    {
                        "access_token": token.access_token,
                        "expires_at": token.expires_at,
                        "token_type": token.token_type,
                    }
                ),
            )
        except Exception:
            _token_store[user_id] = token

        # Fetch profile
        profile: dict[str, Any] | None = None
        try:
            userinfo_resp = await client.get(
                "https://api.linkedin.com/v2/userinfo",
                headers={"Authorization": f"Bearer {token.access_token}"},
            )
            if userinfo_resp.status_code < 400:
                profile = userinfo_resp.json()
        except Exception:
            profile = None

        if profile is not None:
            try:
                r = get_redis()
                r.setex(
                    _redis_profile_key(user_id),
                    max(token.expires_in, 60),
                    json.dumps(profile),
                )
            except Exception:
                _profile_store[user_id] = profile

            external_user_id = str(profile.get("sub")) if profile.get("sub") else None
            display_name = str(profile.get("name")) if profile.get("name") else None
            email = str(profile.get("email")) if profile.get("email") else None
            profile_picture_url = (
                str(profile.get("picture")) if profile.get("picture") else None
            )

            account = session.exec(
                select(SocialAccount).where(
                    SocialAccount.user_id == user_uuid,
                    SocialAccount.platform == "linkedin",
                )
            ).first()

            if account is None:
                account = SocialAccount(
                    user_id=user_uuid,
                    platform="linkedin",
                )

            account.external_user_id = external_user_id
            account.display_name = display_name
            account.email = email
            account.profile_picture_url = profile_picture_url
            account.raw_profile = profile
            account.updated_at = datetime.now(timezone.utc)
            session.add(account)
            session.commit()

    return _frontend_redirect(linkedin="connected")
