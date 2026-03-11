from __future__ import annotations

import json
import time
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException, status

from app.core.redis import get_redis


class LinkedInPostError(HTTPException):
    """Specialized error for LinkedIn post operations."""


_LINKEDIN_VERSION = "202511"
_RESTLI_PROTOCOL_VERSION = "2.0.0"


def _token_redis_key(persona_id: str) -> str:
    return f"linkedin:token:{persona_id}"


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

    def _get_access_token(self, *, persona_id: str) -> str:
        """Load and validate a LinkedIn access token for the given persona."""
        try:
            r = get_redis()
            raw = r.get(_token_redis_key(persona_id))
        except Exception:
            raw = None

        if not raw:
            raise LinkedInPostError(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LinkedIn account not connected. Please connect LinkedIn first.",
            )

        try:
            payload: dict[str, Any] = json.loads(raw)  # type: ignore[arg-type]
        except Exception:
            raise LinkedInPostError(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid LinkedIn token payload. Please reconnect LinkedIn.",
            )

        access_token: str = payload.get("access_token")  # type: ignore[assignment]
        expires_at = payload.get("expires_at")

        if not access_token:
            raise LinkedInPostError(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LinkedIn access token missing. Please reconnect LinkedIn.",
            )

        now = time.time()
        try:
            if expires_at is not None and float(expires_at) <= now:
                raise LinkedInPostError(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="LinkedIn session has expired. Please reconnect LinkedIn.",
                )
        except Exception:
            # If expires_at cannot be parsed, treat it as invalid and ask for reconnect
            raise LinkedInPostError(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LinkedIn session is invalid. Please reconnect LinkedIn.",
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
        persona_id: str,
        linkedin_person_id: str,
        content: str,
    ) -> str:
        """Create a text-only post on the member's LinkedIn profile.

        Returns the LinkedIn Post URN (e.g. `urn:li:ugcPost:...`).
        """
        access_token = self._get_access_token(persona_id=persona_id)
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
                )

        if resp.status_code >= 400:
            raise LinkedInPostError(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LinkedIn rejected the post. Please try again or reconnect LinkedIn.",
            )

        post_urn = resp.headers.get("x-restli-id")
        if not post_urn:
            data = resp.json()
            post_urn = data.get("id")

        if not post_urn:
            raise LinkedInPostError(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LinkedIn did not return a post id. Please try again later.",
            )

        return str(post_urn)

    async def update_text_post(
        self,
        *,
        persona_id: str,
        linkedin_post_urn: str,
        content: str,
    ) -> None:
        """Update the commentary of an existing LinkedIn post."""
        access_token = self._get_access_token(persona_id=persona_id)
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
                )

        if resp.status_code == status.HTTP_404_NOT_FOUND:
            raise LinkedInPostError(
                status_code=status.HTTP_409_CONFLICT,
                detail="LinkedIn post no longer exists. Please create a new post.",
            )

        if resp.status_code >= 400:
            raise LinkedInPostError(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LinkedIn could not update the post. Please try again.",
            )

    async def delete_post(
        self,
        *,
        persona_id: str,
        linkedin_post_urn: str,
    ) -> None:
        """Delete a LinkedIn post.

        Deletions are idempotent: a missing post is treated as success.
        """
        access_token = self._get_access_token(persona_id=persona_id)
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
                )

        if resp.status_code in (status.HTTP_404_NOT_FOUND, status.HTTP_204_NO_CONTENT):
            return

        if resp.status_code >= 400:
            raise LinkedInPostError(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LinkedIn could not delete the post. Please try again.",
            )
