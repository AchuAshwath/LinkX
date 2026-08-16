from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException, status

from app.core.redis import get_redis


@dataclass
class LinkedInPostResult:
    post_id: str
    image_urn: str | None = None


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


def linkedin_token_redis_key(*, user_id: str | uuid.UUID) -> str:
    return f"linkedin:token:{user_id}"


def linkedin_profile_redis_key(*, user_id: str | uuid.UUID) -> str:
    return f"linkedin:profile:{user_id}"


def linkedin_state_redis_key(*, state: str) -> str:
    return f"linkedin:oauth_state:{state}"


def _check_linkedin_response(
    resp: httpx.Response,
    *,
    error_detail: str,
    error_code: str,
) -> None:
    if resp.status_code >= 400:
        retryable = _is_retryable_status(status_code=resp.status_code)
        raise LinkedInPostError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=error_detail,
            code=error_code,
            retryable=retryable,
            details={"platform": "linkedin", "status_code": resp.status_code},
        )


def _handle_request_error(exc: httpx.RequestError, *, action: str) -> LinkedInPostError:
    return LinkedInPostError(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Error {action}: {exc}",
        code="linkedin_network_error",
        retryable=True,
        details={"platform": "linkedin"},
    )


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
            raw = r.get(linkedin_token_redis_key(user_id=user_id))
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
        """Create a text-only post on the member's LinkedIn profile."""
        return await self.create_post(
            text=content,
            user_id=user_id,
            linkedin_person_id=linkedin_person_id,
        )

    def _resolve_auth_credentials(
        self,
        *,
        token: str | None,
        user_id: str | None,
        sub: str | None,
        linkedin_person_id: str | None,
    ) -> tuple[str, str]:
        access_token = token
        if not access_token:
            if user_id:
                access_token = self._get_access_token(user_id=user_id)
            else:
                raise LinkedInPostError(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="LinkedIn access token or user_id is required.",
                    code="linkedin_token_missing",
                    retryable=False,
                )

        person_sub = sub or linkedin_person_id
        if not person_sub:
            raise LinkedInPostError(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LinkedIn person sub/id is required.",
                code="linkedin_sub_missing",
                retryable=False,
            )
        return access_token, person_sub

    def _build_text_post_payload(
        self,
        *,
        person_sub: str,
        commentary: str,
    ) -> dict[str, Any]:
        return {
            "author": f"urn:li:person:{person_sub}",
            "commentary": commentary,
            "visibility": "PUBLIC",
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": [],
            },
            "lifecycleState": "PUBLISHED",
        }

    async def create_post(
        self,
        *,
        text: str,
        user_id: str | None = None,
        sub: str | None = None,
        token: str | None = None,
        linkedin_person_id: str | None = None,
        content: str | None = None,
    ) -> str:
        access_token, person_sub = self._resolve_auth_credentials(
            token=token,
            user_id=user_id,
            sub=sub,
            linkedin_person_id=linkedin_person_id,
        )
        commentary = text if text else (content or "")
        post_payload = self._build_text_post_payload(
            person_sub=person_sub, commentary=commentary
        )
        headers = self._common_headers(access_token=access_token)

        async with httpx.AsyncClient(timeout=30) as client:
            try:
                resp = await client.post(
                    f"{self.base_url}/posts",
                    headers=headers,
                    json=post_payload,
                )
            except httpx.RequestError as exc:
                raise _handle_request_error(exc, action="creating LinkedIn post")

            _check_linkedin_response(
                resp,
                error_detail="LinkedIn rejected the post.",
                error_code="linkedin_publish_failed",
            )
            return self._extract_post_urn(post_resp=resp)

    async def create_image_post(
        self,
        *,
        text: str,
        image_bytes: bytes,
        content_type: str,
        user_id: str | None = None,
        sub: str | None = None,
        token: str | None = None,
        linkedin_person_id: str | None = None,
        content: str | None = None,
        title: str | None = None,
    ) -> LinkedInPostResult:
        access_token, person_sub = self._resolve_auth_credentials(
            token=token,
            user_id=user_id,
            sub=sub,
            linkedin_person_id=linkedin_person_id,
        )
        commentary = text if text else (content or "")
        common_headers = self._common_headers(access_token=access_token)

        async with httpx.AsyncClient(timeout=30) as client:
            upload_url, image_urn = await self._init_image_upload(
                client=client,
                headers=common_headers,
                person_sub=person_sub,
            )
            await self._upload_image_binary(
                client=client,
                upload_url=upload_url,
                access_token=access_token,
                content_type=content_type,
                image_bytes=image_bytes,
            )
            post_urn = await self._create_image_post_record(
                client=client,
                headers=common_headers,
                person_sub=person_sub,
                commentary=commentary,
                image_urn=image_urn,
                title=title,
            )
            return LinkedInPostResult(post_id=post_urn, image_urn=image_urn)

    async def _init_image_upload(
        self,
        *,
        client: httpx.AsyncClient,
        headers: dict[str, str],
        person_sub: str,
    ) -> tuple[str, str]:
        init_payload = {
            "initializeUploadRequest": {
                "owner": f"urn:li:person:{person_sub}",
            }
        }
        try:
            init_resp = await client.post(
                f"{self.base_url}/images?action=initializeUpload",
                headers=headers,
                json=init_payload,
            )
        except httpx.RequestError as exc:
            raise _handle_request_error(
                exc, action="initializing LinkedIn image upload"
            )

        _check_linkedin_response(
            init_resp,
            error_detail="LinkedIn rejected image upload initialization.",
            error_code="linkedin_image_init_failed",
        )

        return self._parse_init_upload_response(init_resp=init_resp)

    def _parse_init_upload_response(
        self, *, init_resp: httpx.Response
    ) -> tuple[str, str]:
        init_data = init_resp.json()
        value = init_data.get("value", {})
        upload_url = value.get("uploadUrl") or init_data.get("uploadUrl")
        image_urn = value.get("image") or init_data.get("image") or init_data.get("id")

        if not upload_url or not image_urn:
            raise LinkedInPostError(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LinkedIn image initialization did not return uploadUrl or image URN.",
                code="linkedin_image_init_missing_data",
                retryable=True,
                details={"platform": "linkedin"},
            )
        return str(upload_url), str(image_urn)

    async def _upload_image_binary(
        self,
        *,
        client: httpx.AsyncClient,
        upload_url: str,
        access_token: str,
        content_type: str,
        image_bytes: bytes,
    ) -> None:
        try:
            upload_resp = await client.put(
                upload_url,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": content_type,
                },
                content=image_bytes,
            )
        except httpx.RequestError as exc:
            raise _handle_request_error(
                exc, action="uploading image binary to LinkedIn"
            )

        _check_linkedin_response(
            upload_resp,
            error_detail="LinkedIn binary image upload failed.",
            error_code="linkedin_image_upload_failed",
        )

    async def _create_image_post_record(
        self,
        *,
        client: httpx.AsyncClient,
        headers: dict[str, str],
        person_sub: str,
        commentary: str,
        image_urn: str,
        title: str | None = None,
    ) -> str:
        payload = self._build_image_post_payload(
            person_sub=person_sub,
            commentary=commentary,
            image_urn=image_urn,
            title=title,
        )

        try:
            post_resp = await client.post(
                f"{self.base_url}/posts",
                headers=headers,
                json=payload,
            )
        except httpx.RequestError as exc:
            raise _handle_request_error(exc, action="creating LinkedIn image post")

        _check_linkedin_response(
            post_resp,
            error_detail="LinkedIn rejected the media post.",
            error_code="linkedin_publish_failed",
        )

        return self._extract_post_urn(post_resp=post_resp)

    def _build_image_post_payload(
        self,
        *,
        person_sub: str,
        commentary: str,
        image_urn: str,
        title: str | None = None,
    ) -> dict[str, Any]:
        return {
            "author": f"urn:li:person:{person_sub}",
            "commentary": commentary,
            "visibility": "PUBLIC",
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": [],
            },
            "content": {
                "media": {
                    "id": image_urn,
                    "title": title or "Post Image",
                }
            },
            "lifecycleState": "PUBLISHED",
        }

    def _extract_post_urn(self, *, post_resp: httpx.Response) -> str:
        post_urn = post_resp.headers.get("x-restli-id")
        if not post_urn:
            post_data = post_resp.json()
            post_urn = post_data.get("id")

        if not post_urn:
            raise LinkedInPostError(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LinkedIn did not return a post id for media post.",
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
                raise _handle_request_error(exc, action="updating LinkedIn post")

        if resp.status_code == status.HTTP_404_NOT_FOUND:
            raise LinkedInPostError(
                status_code=status.HTTP_409_CONFLICT,
                detail="LinkedIn post no longer exists. Please create a new post.",
                code="linkedin_post_not_found",
                retryable=False,
                details={"platform": "linkedin", "status_code": resp.status_code},
            )

        _check_linkedin_response(
            resp,
            error_detail="LinkedIn could not update the post. Please try again.",
            error_code="linkedin_update_failed",
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
                raise _handle_request_error(exc, action="deleting LinkedIn post")

        if resp.status_code in (status.HTTP_404_NOT_FOUND, status.HTTP_204_NO_CONTENT):
            return

        _check_linkedin_response(
            resp,
            error_detail="LinkedIn could not delete the post. Please try again.",
            error_code="linkedin_delete_failed",
        )
