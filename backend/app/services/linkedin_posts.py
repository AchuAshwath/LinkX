from __future__ import annotations

import json
import time
import uuid
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException, status

from app.core.redis import get_redis


class LinkedInPostError(HTTPException):
    """Specialized error for LinkedIn post operations."""

    def __init__(
        self,
        *,
        status_code: int,
        detail: str,
        code: str = "linkedin_publish_failed",
        retryable: bool = False,
        details: dict[str, Any] | None = None,
        trace_id: str | None = None,
    ) -> None:
        self.code = code
        self.retryable = retryable
        self.details = details or {}
        self.trace_id = trace_id or str(uuid.uuid4())
        super().__init__(status_code=status_code, detail=detail)


def _is_retryable_status(*, status_code: int) -> bool:
    return status_code == status.HTTP_429_TOO_MANY_REQUESTS or status_code >= 500


_LINKEDIN_VERSION = "202511"
_RESTLI_PROTOCOL_VERSION = "2.0.0"


def _token_redis_key(user_id: str) -> str:
    return f"linkedin:token:{user_id}"


class LinkedInPostClient:
    """Minimal client for LinkedIn Posts API for member text posts.

    This client assumes:
    - OAuth tokens are stored in Redis under `linkedin:token:{user_id}`
      with JSON payload: {access_token, expires_at, token_type}.
    - The member's LinkedIn person id is the `external_user_id` stored on
      the SocialAccount model and passed in by the caller.
    """

    def __init__(self) -> None:
        self.base_url = "https://api.linkedin.com/rest"

    def _get_access_token(self, *, user_id: str) -> str:
        """Load and validate a LinkedIn access token for the given user."""
        try:
            r = get_redis()
            raw = r.get(_token_redis_key(user_id))
        except Exception:
            raw = None

        if not raw:
            raise LinkedInPostError(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LinkedIn account not connected. Please connect LinkedIn first.",
                code="linkedin_not_connected",
                retryable=False,
                details={"platform": "linkedin"},
            )

        try:
            payload: dict[str, Any] = json.loads(raw)  # type: ignore[arg-type]
        except Exception:
            raise LinkedInPostError(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid LinkedIn token payload. Please reconnect LinkedIn.",
                code="linkedin_token_invalid",
                retryable=False,
                details={"platform": "linkedin"},
            )

        raw_access_token = payload.get("access_token")
        access_token = raw_access_token if isinstance(raw_access_token, str) else ""
        expires_at = payload.get("expires_at")

        if not access_token:
            raise LinkedInPostError(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LinkedIn access token missing. Please reconnect LinkedIn.",
                code="linkedin_token_missing",
                retryable=False,
                details={"platform": "linkedin"},
            )

        now = time.time()
        try:
            if expires_at is not None and float(expires_at) <= now:
                raise LinkedInPostError(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="LinkedIn session has expired. Please reconnect LinkedIn.",
                    code="linkedin_token_expired",
                    retryable=False,
                    details={"platform": "linkedin"},
                )
        except Exception:
            # If expires_at cannot be parsed, treat it as invalid and ask for reconnect
            raise LinkedInPostError(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LinkedIn session is invalid. Please reconnect LinkedIn.",
                code="linkedin_session_invalid",
                retryable=False,
                details={"platform": "linkedin"},
            )

        return access_token

    def _common_headers(self, *, access_token: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {access_token}",
            "Linkedin-Version": _LINKEDIN_VERSION,
            "X-Restli-Protocol-Version": _RESTLI_PROTOCOL_VERSION,
            "Content-Type": "application/json",
        }

    async def create_text_post(
        self,
        *,
        user_id: str,
        linkedin_person_id: str,
        content: str,
    ) -> str:
        """Create a text-only post on the member's LinkedIn profile.

        Returns the LinkedIn Post URN (e.g. `urn:li:ugcPost:...`).
        """
        access_token = self._get_access_token(user_id=user_id)
        author_urn = f"urn:li:person:{linkedin_person_id}"

        payload = {
            "author": author_urn,
            "commentary": content,
            "visibility": "PUBLIC",
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": [],
            },
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
        }

        async with httpx.AsyncClient(timeout=20) as client:
            try:
                resp = await client.post(
                    f"{self.base_url}/posts",
                    headers=self._common_headers(access_token=access_token),
                    json=payload,
                )
            except httpx.RequestError as exc:
                raise LinkedInPostError(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Error communicating with LinkedIn: {exc}",
                    code="linkedin_network_error",
                    retryable=True,
                    details={"platform": "linkedin"},
                )

        if resp.status_code >= 400:
            retryable = _is_retryable_status(status_code=resp.status_code)
            raise LinkedInPostError(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LinkedIn rejected the post. Please try again or reconnect LinkedIn.",
                code="linkedin_publish_failed",
                retryable=retryable,
                details={"platform": "linkedin", "status_code": resp.status_code},
            )

        post_urn = resp.headers.get("x-restli-id")
        if not post_urn:
            data = resp.json()
            post_urn = data.get("id")

        if not post_urn:
            raise LinkedInPostError(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LinkedIn did not return a post id. Please try again later.",
                code="linkedin_missing_post_id",
                retryable=True,
                details={"platform": "linkedin"},
            )

        return str(post_urn)

    async def update_text_post(
        self,
        *,
        user_id: str,
        linkedin_post_urn: str,
        content: str,
    ) -> None:
        """Update the commentary of an existing LinkedIn post."""
        access_token = self._get_access_token(user_id=user_id)
        encoded_urn = quote(linkedin_post_urn, safe="")

        payload = {
            "patch": {
                "$set": {
                    "commentary": content,
                }
            }
        }

        headers = self._common_headers(access_token=access_token)
        headers["X-RestLi-Method"] = "PARTIAL_UPDATE"

        async with httpx.AsyncClient(timeout=20) as client:
            try:
                resp = await client.post(
                    f"{self.base_url}/posts/{encoded_urn}",
                    headers=headers,
                    json=payload,
                )
            except httpx.RequestError as exc:
                raise LinkedInPostError(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Error communicating with LinkedIn: {exc}",
                    code="linkedin_network_error",
                    retryable=True,
                    details={"platform": "linkedin"},
                )

        if resp.status_code == status.HTTP_404_NOT_FOUND:
            raise LinkedInPostError(
                status_code=status.HTTP_409_CONFLICT,
                detail="LinkedIn post no longer exists. Please create a new post.",
                code="linkedin_post_not_found",
                retryable=False,
                details={"platform": "linkedin", "status_code": resp.status_code},
            )

        if resp.status_code >= 400:
            retryable = _is_retryable_status(status_code=resp.status_code)
            raise LinkedInPostError(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LinkedIn could not update the post. Please try again.",
                code="linkedin_update_failed",
                retryable=retryable,
                details={"platform": "linkedin", "status_code": resp.status_code},
            )

    async def delete_post(
        self,
        *,
        user_id: str,
        linkedin_post_urn: str,
    ) -> None:
        """Delete a LinkedIn post.

        Deletions are idempotent: a missing post is treated as success.
        """
        access_token = self._get_access_token(user_id=user_id)
        encoded_urn = quote(linkedin_post_urn, safe="")

        headers = self._common_headers(access_token=access_token)
        headers["X-RestLi-Method"] = "DELETE"

        async with httpx.AsyncClient(timeout=20) as client:
            try:
                resp = await client.delete(
                    f"{self.base_url}/posts/{encoded_urn}",
                    headers=headers,
                )
            except httpx.RequestError as exc:
                raise LinkedInPostError(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Error communicating with LinkedIn: {exc}",
                    code="linkedin_network_error",
                    retryable=True,
                    details={"platform": "linkedin"},
                )

        if resp.status_code in (status.HTTP_404_NOT_FOUND, status.HTTP_204_NO_CONTENT):
            return

        if resp.status_code >= 400:
            retryable = _is_retryable_status(status_code=resp.status_code)
            raise LinkedInPostError(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LinkedIn could not delete the post. Please try again.",
                code="linkedin_delete_failed",
                retryable=retryable,
                details={"platform": "linkedin", "status_code": resp.status_code},
            )
