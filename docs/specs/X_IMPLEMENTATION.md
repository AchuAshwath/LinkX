# X (Twitter) Integration - Technical Specification

**Version**: 1.0
**Status**: Draft
**Author**: LinkX Team
**Date**: January 2026
**Parent Spec**: [SOCIAL_MEDIA_INTEGRATION.md](./SOCIAL_MEDIA_INTEGRATION.md)

---

## 1. Overview

### 1.1 Summary

This specification details the implementation of X (formerly Twitter) integration for LinkX, enabling users to connect their X accounts and schedule/publish tweets. This builds upon the generic social platform architecture defined in the parent specification.

### 1.2 Goals

- Implement X as the second platform adapter (after LinkedIn)
- Support OAuth 2.0 with PKCE authentication flow
- Enable text and media tweet posting
- Support tweet scheduling via existing Celery infrastructure
- Enable cross-posting to X and LinkedIn simultaneously

### 1.3 Non-Goals (Out of Scope for v1)

- Twitter Spaces integration
- Direct Messages
- Twitter Analytics
- Twitter Ads API
- Polls (requires elevated access)
- Twitter Communities posting

---

## 2. Architecture

### 2.1 Platform Adapter Pattern

X integration follows the `SocialPlatformAdapter` interface defined in the parent spec:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SocialPlatformAdapter                         │
├─────────────────────────────────────────────────────────────────┤
│  + authenticate(auth_code, code_verifier) → TokenResponse       │
│  + refresh_token(refresh_token) → TokenResponse                 │
│  + get_profile(access_token) → ProfileInfo                      │
│  + upload_media(access_token, file) → MediaUploadResult         │
│  + create_post(access_token, post) → PostResult                 │
│  + delete_post(access_token, post_id) → bool                    │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ implements
              ┌───────────────┴───────────────┐
              │                               │
┌─────────────────────────┐     ┌─────────────────────────┐
│    LinkedInAdapter      │     │      XAdapter           │
├─────────────────────────┤     ├─────────────────────────┤
│  - OAuth 2.0 (no PKCE)  │     │  - OAuth 2.0 with PKCE  │
│  - Posts API v2         │     │  - Tweets API v2        │
│  - Images/Videos API    │     │  - Media Upload v1.1    │
└─────────────────────────┘     └─────────────────────────┘
```

### 2.2 System Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Frontend                                     │
│                                                                          │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐         │
│   │ Connect X   │───▶│ Post        │───▶│ Schedule/Publish    │         │
│   │ Button      │    │ Composer    │    │ to X + LinkedIn     │         │
│   └─────────────┘    └─────────────┘    └─────────────────────┘         │
└──────────────────────────────────────────────────────────────────────────┘
           │                    │                      │
           ▼                    ▼                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           Backend (FastAPI)                               │
│                                                                          │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐ │
│   │ XOAuthService   │  │ XMediaService   │  │ XPostService            │ │
│   │                 │  │                 │  │                         │ │
│   │ - PKCE flow     │  │ - Image upload  │  │ - Create tweet          │ │
│   │ - Token refresh │  │ - Video upload  │  │ - Delete tweet          │ │
│   │ - User profile  │  │ - GIF upload    │  │ - Thread creation       │ │
│   └─────────────────┘  └─────────────────┘  └─────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
           │                    │                      │
           ▼                    ▼                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                              X API                                        │
│                                                                          │
│   OAuth 2.0          Media Upload v1.1      Tweets API v2                │
│   /2/oauth2/token    /1.1/media/upload     /2/tweets                     │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Database Schema

The X integration uses the generic `social_accounts` and `social_posts` tables defined in the parent spec. No X-specific tables are required.

### 3.1 Platform-Specific Fields

#### social_accounts.metadata (JSONB)

```json
{
  "x_user_id": "123456789",
  "username": "johndoe",
  "name": "John Doe",
  "profile_image_url": "https://pbs.twimg.com/...",
  "verified": false,
  "verified_type": null,
  "followers_count": 1234,
  "following_count": 567,
  "tweet_count": 890
}
```

#### social_posts.platform_settings (JSONB)

```json
{
  "x": {
    "reply_settings": "everyone",
    "quote_tweet_id": null,
    "reply_to_tweet_id": null,
    "for_super_followers_only": false
  }
}
```

### 3.2 Platform Enum Update

```sql
-- Add 'x' to platform enum (if using enum type)
-- Or ensure validation accepts 'x' as valid platform value
ALTER TYPE social_platform ADD VALUE 'x';
```

---

## 4. X Adapter Implementation

### 4.1 XAdapter Class

```python
# app/services/social/adapters/x_adapter.py

from abc import ABC
from typing import Optional
import httpx
import secrets
import hashlib
import base64

from app.services.social.base import (
    SocialPlatformAdapter,
    TokenResponse,
    ProfileInfo,
    MediaUploadResult,
    PostContent,
    PostResult,
)
from app.core.config import settings


class XAdapter(SocialPlatformAdapter):
    """X (Twitter) platform adapter implementation."""

    PLATFORM = "x"
    API_BASE_URL = "https://api.x.com/2"
    MEDIA_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json"
    OAUTH_AUTHORIZE_URL = "https://twitter.com/i/oauth2/authorize"
    OAUTH_TOKEN_URL = "https://api.x.com/2/oauth2/token"

    REQUIRED_SCOPES = [
        "tweet.read",
        "tweet.write",
        "users.read",
        "offline.access",
    ]

    def __init__(self):
        self.client_id = settings.X_CLIENT_ID
        self.client_secret = settings.X_CLIENT_SECRET
        self.redirect_uri = settings.X_REDIRECT_URI

    # ─────────────────────────────────────────────────────────────
    # PKCE Helpers
    # ─────────────────────────────────────────────────────────────

    @staticmethod
    def generate_pkce_pair() -> tuple[str, str]:
        """Generate PKCE code_verifier and code_challenge."""
        code_verifier = secrets.token_urlsafe(32)
        code_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(code_verifier.encode()).digest()
        ).decode().rstrip('=')
        return code_verifier, code_challenge

    # ─────────────────────────────────────────────────────────────
    # OAuth 2.0 Methods
    # ─────────────────────────────────────────────────────────────

    def get_authorization_url(self, state: str, code_challenge: str) -> str:
        """Generate OAuth 2.0 authorization URL with PKCE."""
        params = {
            "response_type": "code",
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": " ".join(self.REQUIRED_SCOPES),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        query = "&".join(f"{k}={v}" for k, v in params.items())
        return f"{self.OAUTH_AUTHORIZE_URL}?{query}"

    async def authenticate(
        self,
        auth_code: str,
        code_verifier: str
    ) -> TokenResponse:
        """Exchange authorization code for tokens."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.OAUTH_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": auth_code,
                    "redirect_uri": self.redirect_uri,
                    "code_verifier": code_verifier,
                },
                auth=(self.client_id, self.client_secret),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            response.raise_for_status()
            data = response.json()

            return TokenResponse(
                access_token=data["access_token"],
                refresh_token=data.get("refresh_token"),
                expires_in=data["expires_in"],  # 7200 seconds (2 hours)
                scope=data["scope"],
                token_type=data["token_type"],
            )

    async def refresh_token(self, refresh_token: str) -> TokenResponse:
        """Refresh an expired access token."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.OAUTH_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                },
                auth=(self.client_id, self.client_secret),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            response.raise_for_status()
            data = response.json()

            return TokenResponse(
                access_token=data["access_token"],
                refresh_token=data.get("refresh_token", refresh_token),
                expires_in=data["expires_in"],
                scope=data["scope"],
                token_type=data["token_type"],
            )

    # ─────────────────────────────────────────────────────────────
    # Profile Methods
    # ─────────────────────────────────────────────────────────────

    async def get_profile(self, access_token: str) -> ProfileInfo:
        """Get authenticated user's profile."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.API_BASE_URL}/users/me",
                headers={"Authorization": f"Bearer {access_token}"},
                params={
                    "user.fields": "id,name,username,profile_image_url,"
                                   "verified,verified_type,public_metrics"
                },
            )
            response.raise_for_status()
            data = response.json()["data"]

            return ProfileInfo(
                platform_user_id=data["id"],
                username=data["username"],
                display_name=data["name"],
                profile_picture_url=data.get("profile_image_url"),
                email=None,  # X doesn't provide email via API v2
                metadata={
                    "verified": data.get("verified", False),
                    "verified_type": data.get("verified_type"),
                    "followers_count": data.get("public_metrics", {}).get("followers_count"),
                    "following_count": data.get("public_metrics", {}).get("following_count"),
                    "tweet_count": data.get("public_metrics", {}).get("tweet_count"),
                },
            )

    # ─────────────────────────────────────────────────────────────
    # Media Upload Methods
    # ─────────────────────────────────────────────────────────────

    async def upload_media(
        self,
        access_token: str,
        file_path: str,
        media_type: str,  # 'image', 'gif', 'video'
        mime_type: str,
    ) -> MediaUploadResult:
        """Upload media to X."""
        # For images and GIFs: simple upload
        # For videos: chunked upload (INIT, APPEND, FINALIZE)

        if media_type == "video":
            return await self._upload_video_chunked(
                access_token, file_path, mime_type
            )
        else:
            return await self._upload_media_simple(
                access_token, file_path, mime_type
            )

    async def _upload_media_simple(
        self,
        access_token: str,
        file_path: str,
        mime_type: str,
    ) -> MediaUploadResult:
        """Simple media upload for images and GIFs."""
        import aiofiles

        async with aiofiles.open(file_path, 'rb') as f:
            media_data = await f.read()

        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.MEDIA_UPLOAD_URL,
                headers={"Authorization": f"Bearer {access_token}"},
                files={"media": media_data},
            )
            response.raise_for_status()
            data = response.json()

            return MediaUploadResult(
                media_id=data["media_id_string"],
                media_key=data.get("media_key"),
                status="ready",
                expires_at=None,
            )

    async def _upload_video_chunked(
        self,
        access_token: str,
        file_path: str,
        mime_type: str,
    ) -> MediaUploadResult:
        """Chunked upload for videos (required for files > 5MB)."""
        import aiofiles
        import os

        file_size = os.path.getsize(file_path)
        headers = {"Authorization": f"Bearer {access_token}"}

        async with httpx.AsyncClient() as client:
            # INIT
            init_response = await client.post(
                self.MEDIA_UPLOAD_URL,
                headers=headers,
                data={
                    "command": "INIT",
                    "total_bytes": file_size,
                    "media_type": mime_type,
                    "media_category": "tweet_video",
                },
            )
            init_response.raise_for_status()
            media_id = init_response.json()["media_id_string"]

            # APPEND (in chunks)
            chunk_size = 5 * 1024 * 1024  # 5MB chunks
            segment_index = 0

            async with aiofiles.open(file_path, 'rb') as f:
                while True:
                    chunk = await f.read(chunk_size)
                    if not chunk:
                        break

                    append_response = await client.post(
                        self.MEDIA_UPLOAD_URL,
                        headers=headers,
                        data={
                            "command": "APPEND",
                            "media_id": media_id,
                            "segment_index": segment_index,
                        },
                        files={"media": chunk},
                    )
                    append_response.raise_for_status()
                    segment_index += 1

            # FINALIZE
            finalize_response = await client.post(
                self.MEDIA_UPLOAD_URL,
                headers=headers,
                data={
                    "command": "FINALIZE",
                    "media_id": media_id,
                },
            )
            finalize_response.raise_for_status()
            finalize_data = finalize_response.json()

            # Check processing status for videos
            if "processing_info" in finalize_data:
                return MediaUploadResult(
                    media_id=media_id,
                    media_key=finalize_data.get("media_key"),
                    status="processing",
                    processing_info=finalize_data["processing_info"],
                )

            return MediaUploadResult(
                media_id=media_id,
                media_key=finalize_data.get("media_key"),
                status="ready",
            )

    async def check_media_status(
        self,
        access_token: str,
        media_id: str,
    ) -> MediaUploadResult:
        """Check video processing status."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                self.MEDIA_UPLOAD_URL,
                headers={"Authorization": f"Bearer {access_token}"},
                params={
                    "command": "STATUS",
                    "media_id": media_id,
                },
            )
            response.raise_for_status()
            data = response.json()

            processing_info = data.get("processing_info", {})
            state = processing_info.get("state", "succeeded")

            return MediaUploadResult(
                media_id=media_id,
                media_key=data.get("media_key"),
                status="ready" if state == "succeeded" else "processing",
                processing_info=processing_info if state != "succeeded" else None,
                error=processing_info.get("error") if state == "failed" else None,
            )

    # ─────────────────────────────────────────────────────────────
    # Post Methods
    # ─────────────────────────────────────────────────────────────

    async def create_post(
        self,
        access_token: str,
        post: PostContent
    ) -> PostResult:
        """Create a tweet."""
        payload = {"text": post.text}

        # Add media if present
        if post.media_ids:
            payload["media"] = {"media_ids": post.media_ids}

        # Add reply settings
        if post.platform_settings:
            x_settings = post.platform_settings.get("x", {})

            if x_settings.get("reply_settings"):
                payload["reply_settings"] = x_settings["reply_settings"]

            if x_settings.get("reply_to_tweet_id"):
                payload["reply"] = {
                    "in_reply_to_tweet_id": x_settings["reply_to_tweet_id"]
                }

            if x_settings.get("quote_tweet_id"):
                payload["quote_tweet_id"] = x_settings["quote_tweet_id"]

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.API_BASE_URL}/tweets",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()["data"]

            return PostResult(
                platform_post_id=data["id"],
                platform_post_url=f"https://x.com/i/status/{data['id']}",
                text=data.get("text"),
            )

    async def delete_post(
        self,
        access_token: str,
        post_id: str
    ) -> bool:
        """Delete a tweet."""
        async with httpx.AsyncClient() as client:
            response = await client.delete(
                f"{self.API_BASE_URL}/tweets/{post_id}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            return response.json()["data"]["deleted"]

    # ─────────────────────────────────────────────────────────────
    # Thread Support
    # ─────────────────────────────────────────────────────────────

    async def create_thread(
        self,
        access_token: str,
        tweets: list[PostContent],
    ) -> list[PostResult]:
        """Create a thread of tweets."""
        results = []
        reply_to_id = None

        for tweet in tweets:
            if reply_to_id:
                tweet.platform_settings = tweet.platform_settings or {}
                tweet.platform_settings["x"] = tweet.platform_settings.get("x", {})
                tweet.platform_settings["x"]["reply_to_tweet_id"] = reply_to_id

            result = await self.create_post(access_token, tweet)
            results.append(result)
            reply_to_id = result.platform_post_id

        return results
```

### 4.2 Data Classes

```python
# app/services/social/base.py (additions)

from dataclasses import dataclass, field
from typing import Optional, Any


@dataclass
class TokenResponse:
    access_token: str
    refresh_token: Optional[str]
    expires_in: int
    scope: str
    token_type: str


@dataclass
class ProfileInfo:
    platform_user_id: str
    username: str
    display_name: str
    profile_picture_url: Optional[str] = None
    email: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class MediaUploadResult:
    media_id: str
    media_key: Optional[str] = None
    status: str = "ready"  # 'ready', 'processing', 'failed'
    processing_info: Optional[dict] = None
    error: Optional[str] = None
    expires_at: Optional[str] = None


@dataclass
class PostContent:
    text: str
    media_ids: list[str] = field(default_factory=list)
    platform_settings: Optional[dict[str, Any]] = None


@dataclass
class PostResult:
    platform_post_id: str
    platform_post_url: str
    text: Optional[str] = None
    error: Optional[str] = None
```

---

## 5. API Endpoints

### 5.1 OAuth Routes

```python
# app/api/routes/auth/x.py

from fastapi import APIRouter, Query, HTTPException, Response
from fastapi.responses import RedirectResponse
import secrets

from app.api.deps import SessionDep, CurrentUser
from app.services.social.adapters.x_adapter import XAdapter
from app.crud.social_accounts import create_social_account
from app.core.config import settings

router = APIRouter(prefix="/auth/x", tags=["x-auth"])
x_adapter = XAdapter()

# In-memory storage for PKCE verifiers (use Redis in production)
pkce_storage: dict[str, str] = {}


@router.get("/authorize")
async def authorize_x(current_user: CurrentUser):
    """Initiate X OAuth 2.0 flow."""
    state = secrets.token_urlsafe(32)
    code_verifier, code_challenge = x_adapter.generate_pkce_pair()

    # Store verifier for callback (use Redis in production)
    pkce_storage[state] = code_verifier

    auth_url = x_adapter.get_authorization_url(state, code_challenge)
    return {"authorization_url": auth_url, "state": state}


@router.get("/callback")
async def x_callback(
    session: SessionDep,
    current_user: CurrentUser,
    code: str = Query(...),
    state: str = Query(...),
):
    """Handle X OAuth callback."""
    # Retrieve and remove PKCE verifier
    code_verifier = pkce_storage.pop(state, None)
    if not code_verifier:
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    try:
        # Exchange code for tokens
        tokens = await x_adapter.authenticate(code, code_verifier)

        # Get user profile
        profile = await x_adapter.get_profile(tokens.access_token)

        # Store account
        account = create_social_account(
            session=session,
            user_id=current_user.id,
            platform="x",
            platform_user_id=profile.platform_user_id,
            display_name=profile.display_name,
            username=profile.username,
            profile_picture_url=profile.profile_picture_url,
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
            token_expires_at=tokens.expires_in,
            metadata=profile.metadata,
        )

        # Redirect to frontend with success
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/settings?x_connected=true"
        )

    except Exception as e:
        # Redirect to frontend with error
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/settings?x_error={str(e)}"
        )
```

### 5.2 Post Routes

```python
# app/api/routes/social/x.py

from fastapi import APIRouter, HTTPException, UploadFile, File
from typing import Optional

from app.api.deps import SessionDep, CurrentUser
from app.services.social.adapters.x_adapter import XAdapter
from app.services.social.post_service import SocialPostService
from app.models.social import SocialPostCreate, SocialPost

router = APIRouter(prefix="/x", tags=["x"])
x_adapter = XAdapter()


@router.post("/posts")
async def create_x_post(
    session: SessionDep,
    current_user: CurrentUser,
    post_data: SocialPostCreate,
):
    """Create a new tweet (immediate or scheduled)."""
    service = SocialPostService(session, x_adapter)

    if post_data.scheduled_at:
        # Schedule for later
        return await service.schedule_post(
            user_id=current_user.id,
            account_id=post_data.account_id,
            content=post_data.content,
            media_ids=post_data.media_ids,
            scheduled_at=post_data.scheduled_at,
            platform_settings=post_data.platform_settings,
        )
    else:
        # Publish immediately
        return await service.publish_post(
            user_id=current_user.id,
            account_id=post_data.account_id,
            content=post_data.content,
            media_ids=post_data.media_ids,
            platform_settings=post_data.platform_settings,
        )


@router.post("/media/upload")
async def upload_x_media(
    session: SessionDep,
    current_user: CurrentUser,
    account_id: str,
    file: UploadFile = File(...),
):
    """Upload media for X posts."""
    # Validate file type
    allowed_types = {
        "image/jpeg": "image",
        "image/png": "image",
        "image/gif": "gif",
        "image/webp": "image",
        "video/mp4": "video",
    }

    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}"
        )

    media_type = allowed_types[file.content_type]

    # Save file temporarily
    temp_path = await save_temp_file(file)

    try:
        # Get account and upload
        account = get_social_account(session, account_id, current_user.id)

        result = await x_adapter.upload_media(
            access_token=account.access_token,
            file_path=temp_path,
            media_type=media_type,
            mime_type=file.content_type,
        )

        # Store in media library
        media = create_media_record(
            session=session,
            user_id=current_user.id,
            platform="x",
            media_id=result.media_id,
            media_type=media_type,
            filename=file.filename,
            mime_type=file.content_type,
        )

        return media

    finally:
        # Cleanup temp file
        os.unlink(temp_path)


@router.delete("/posts/{post_id}")
async def delete_x_post(
    session: SessionDep,
    current_user: CurrentUser,
    post_id: str,
):
    """Delete a tweet."""
    post = get_social_post(session, post_id, current_user.id)

    if post.status == "published" and post.platform_post_id:
        account = get_social_account(session, post.social_account_id)
        await x_adapter.delete_post(account.access_token, post.platform_post_id)

    delete_post_record(session, post_id)
    return {"deleted": True}
```

---

## 6. X API Integration Details

### 6.1 API Endpoints Reference

| Action | Method | Endpoint | API Version |
|--------|--------|----------|-------------|
| Create tweet | POST | `/2/tweets` | v2 |
| Delete tweet | DELETE | `/2/tweets/:id` | v2 |
| Get user | GET | `/2/users/me` | v2 |
| Upload media | POST | `/1.1/media/upload.json` | v1.1 |
| OAuth token | POST | `/2/oauth2/token` | v2 |

### 6.2 Request Headers

```python
headers = {
    "Authorization": f"Bearer {access_token}",
    "Content-Type": "application/json",
}
```

### 6.3 Create Tweet Request

```json
{
  "text": "Hello, world!",
  "media": {
    "media_ids": ["1234567890"]
  },
  "reply_settings": "everyone",
  "reply": {
    "in_reply_to_tweet_id": "9876543210"
  },
  "quote_tweet_id": "1111111111"
}
```

### 6.4 Create Tweet Response

```json
{
  "data": {
    "id": "1234567890123456789",
    "text": "Hello, world!"
  }
}
```

### 6.5 Error Response Format

```json
{
  "errors": [
    {
      "message": "You are not permitted to perform this action.",
      "code": 403
    }
  ]
}
```

---

## 7. Media Upload Flow

### 7.1 Image/GIF Upload (Simple)

```
Frontend                    Backend                         X API
   │                           │                              │
   │ POST /x/media/upload      │                              │
   │ (file)                    │                              │
   │──────────────────────────▶│                              │
   │                           │ POST /1.1/media/upload.json  │
   │                           │ (media binary)               │
   │                           │─────────────────────────────▶│
   │                           │                              │
   │                           │◀─────────────────────────────│
   │                           │ { media_id_string }          │
   │◀──────────────────────────│                              │
   │ { media_id, status }      │                              │
```

### 7.2 Video Upload (Chunked)

```
Frontend                    Backend                         X API
   │                           │                              │
   │ POST /x/media/upload      │                              │
   │ (video file)              │                              │
   │──────────────────────────▶│                              │
   │                           │ INIT command                 │
   │                           │─────────────────────────────▶│
   │                           │◀─────────────────────────────│
   │                           │ { media_id }                 │
   │                           │                              │
   │                           │ APPEND (chunk 1)             │
   │                           │─────────────────────────────▶│
   │                           │ APPEND (chunk 2)             │
   │                           │─────────────────────────────▶│
   │                           │ ... more chunks              │
   │                           │                              │
   │                           │ FINALIZE                     │
   │                           │─────────────────────────────▶│
   │                           │◀─────────────────────────────│
   │                           │ { processing_info }          │
   │◀──────────────────────────│                              │
   │ { media_id, status:       │                              │
   │   "processing" }          │                              │
   │                           │                              │
   │ GET /x/media/{id}/status  │                              │
   │──────────────────────────▶│ STATUS command               │
   │                           │─────────────────────────────▶│
   │                           │◀─────────────────────────────│
   │◀──────────────────────────│ { state: "succeeded" }       │
   │ { status: "ready" }       │                              │
```

---

## 8. Character Limits and Validation

### 8.1 Tweet Validation

```python
# app/services/social/validators/x_validator.py

from dataclasses import dataclass
import re

@dataclass
class XValidationResult:
    valid: bool
    character_count: int
    errors: list[str]
    warnings: list[str]


class XValidator:
    MAX_TWEET_LENGTH = 280
    URL_LENGTH = 23  # All URLs are shortened to 23 chars

    # URL regex pattern
    URL_PATTERN = re.compile(
        r'https?://[^\s<>"{}|\\^`\[\]]+',
        re.IGNORECASE
    )

    def validate_tweet(self, text: str, media_count: int = 0) -> XValidationResult:
        errors = []
        warnings = []

        # Calculate effective length (URLs = 23 chars each)
        effective_text = self.URL_PATTERN.sub('x' * self.URL_LENGTH, text)
        char_count = len(effective_text)

        if char_count > self.MAX_TWEET_LENGTH:
            errors.append(
                f"Tweet exceeds {self.MAX_TWEET_LENGTH} characters "
                f"({char_count} characters)"
            )

        if media_count > 4:
            errors.append("Maximum 4 images per tweet")

        if char_count > 250:
            warnings.append("Long tweets may have lower engagement")

        return XValidationResult(
            valid=len(errors) == 0,
            character_count=char_count,
            errors=errors,
            warnings=warnings,
        )
```

---

## 9. X-Specific Features

### 9.1 Reply Settings

| Value | Description |
|-------|-------------|
| `everyone` | Anyone can reply (default) |
| `mentionedUsers` | Only mentioned users can reply |
| `following` | Only followers can reply |

### 9.2 Thread Creation

Threads are created by posting tweets as replies to each other:

```python
# Create a thread
thread_content = [
    PostContent(text="1/3 This is the first tweet in my thread..."),
    PostContent(text="2/3 Continuing the discussion..."),
    PostContent(text="3/3 And the conclusion!"),
]

results = await x_adapter.create_thread(access_token, thread_content)
```

### 9.3 Quote Tweets

```python
# Quote another tweet
post = PostContent(
    text="Great insight here!",
    platform_settings={
        "x": {"quote_tweet_id": "1234567890123456789"}
    }
)
```

---

## 10. Frontend Components

### 10.1 New Components

```
src/components/Social/
├── X/
│   ├── ConnectXButton.tsx       # OAuth initiation
│   ├── XAccountCard.tsx         # Display connected X account
│   ├── XCharacterCounter.tsx    # Real-time character count
│   ├── XPostPreview.tsx         # Tweet preview
│   └── XThreadComposer.tsx      # Thread creation UI
├── Shared/
│   ├── PlatformSelector.tsx     # Select X, LinkedIn, etc.
│   ├── CrossPostToggle.tsx      # Enable cross-posting
│   └── MediaUploader.tsx        # Unified media upload
```

### 10.2 Character Counter Component

```tsx
// src/components/Social/X/XCharacterCounter.tsx

interface XCharacterCounterProps {
  text: string
  maxLength?: number
}

export function XCharacterCounter({
  text,
  maxLength = 280
}: XCharacterCounterProps) {
  // Calculate effective length (URLs = 23 chars)
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi
  const effectiveText = text.replace(urlPattern, 'x'.repeat(23))
  const count = effectiveText.length
  const remaining = maxLength - count

  const getColor = () => {
    if (remaining < 0) return 'text-red-500'
    if (remaining < 20) return 'text-yellow-500'
    return 'text-muted-foreground'
  }

  return (
    <div className={`text-sm ${getColor()}`}>
      {remaining < 0 ? (
        <span>{remaining} characters over limit</span>
      ) : (
        <span>{remaining} characters remaining</span>
      )}
    </div>
  )
}
```

---

## 11. Testing Strategy

### 11.1 Unit Tests

```python
# tests/services/social/test_x_adapter.py

import pytest
from unittest.mock import AsyncMock, patch

from app.services.social.adapters.x_adapter import XAdapter


class TestXAdapter:
    @pytest.fixture
    def adapter(self):
        return XAdapter()

    def test_generate_pkce_pair(self, adapter):
        verifier, challenge = adapter.generate_pkce_pair()
        assert len(verifier) >= 43
        assert len(challenge) >= 43
        assert verifier != challenge

    @pytest.mark.asyncio
    async def test_authenticate_success(self, adapter):
        with patch('httpx.AsyncClient.post') as mock_post:
            mock_post.return_value.json.return_value = {
                "access_token": "test_token",
                "refresh_token": "test_refresh",
                "expires_in": 7200,
                "scope": "tweet.read tweet.write",
                "token_type": "bearer",
            }
            mock_post.return_value.raise_for_status = lambda: None

            result = await adapter.authenticate("code", "verifier")

            assert result.access_token == "test_token"
            assert result.expires_in == 7200

    @pytest.mark.asyncio
    async def test_create_post_with_media(self, adapter):
        with patch('httpx.AsyncClient.post') as mock_post:
            mock_post.return_value.json.return_value = {
                "data": {
                    "id": "123456789",
                    "text": "Test tweet"
                }
            }
            mock_post.return_value.raise_for_status = lambda: None

            from app.services.social.base import PostContent
            post = PostContent(
                text="Test tweet",
                media_ids=["media_123"]
            )

            result = await adapter.create_post("token", post)

            assert result.platform_post_id == "123456789"
            assert "x.com" in result.platform_post_url
```

### 11.2 Integration Tests

```python
# tests/api/routes/test_x_auth.py

import pytest
from httpx import AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_x_authorize_returns_url():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get(
            "/api/v1/auth/x/authorize",
            headers={"Authorization": "Bearer test_token"}
        )

        assert response.status_code == 200
        data = response.json()
        assert "authorization_url" in data
        assert "twitter.com" in data["authorization_url"]
        assert "state" in data
```

### 11.3 E2E Tests (Playwright)

```typescript
// tests/x-integration.spec.ts

import { test, expect } from '@playwright/test'

test.describe('X Integration', () => {
  test('should connect X account', async ({ page }) => {
    await page.goto('/settings')

    // Click connect X button
    await page.click('[data-testid="connect-x-button"]')

    // Should redirect to X OAuth
    await expect(page).toHaveURL(/twitter\.com\/i\/oauth2\/authorize/)
  })

  test('should create tweet with character counter', async ({ page }) => {
    await page.goto('/compose')

    // Select X platform
    await page.click('[data-testid="platform-x"]')

    // Type tweet
    const composer = page.locator('[data-testid="tweet-composer"]')
    await composer.fill('Hello, world!')

    // Check character counter
    const counter = page.locator('[data-testid="char-counter"]')
    await expect(counter).toContainText('267')
  })
})
```

---

## 12. Implementation Phases

### Phase 2a: X Core Integration (Week 5)
*Aligned with parent spec Phase 2*

- [ ] XAdapter class implementation
- [ ] OAuth 2.0 with PKCE flow
- [ ] Token storage and refresh
- [ ] User profile fetching
- [ ] Basic text tweet posting

### Phase 2b: X Media Support (Week 6)

- [ ] Image upload (simple)
- [ ] GIF upload
- [ ] Video upload (chunked)
- [ ] Media status polling
- [ ] Media library integration

### Phase 2c: X Frontend Integration (Week 6-7)

- [ ] Connect X account button
- [ ] X account card in settings
- [ ] Character counter component
- [ ] Tweet preview
- [ ] Platform selector (X + LinkedIn)

### Phase 2d: Cross-Posting (Week 7)

- [ ] Multi-platform post creation
- [ ] Platform-specific settings UI
- [ ] Cross-post scheduling
- [ ] Per-platform result tracking

---

## 13. Configuration

### 13.1 Environment Variables

```bash
# Required for X integration
X_CLIENT_ID=your_client_id
X_CLIENT_SECRET=your_client_secret
X_REDIRECT_URI=http://localhost:8000/api/v1/auth/x/callback

# Optional
X_BEARER_TOKEN=your_bearer_token  # For app-only auth (not user context)
```

### 13.2 Settings Class Update

```python
# app/core/config.py (additions)

class Settings(BaseSettings):
    # ... existing settings ...

    # X (Twitter) OAuth 2.0
    X_CLIENT_ID: str = ""
    X_CLIENT_SECRET: str = ""
    X_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/x/callback"
    X_BEARER_TOKEN: str | None = None
```

---

## 14. References

- [X API v2 Documentation](https://developer.x.com/en/docs/twitter-api)
- [OAuth 2.0 with PKCE](https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code)
- [Manage Tweets API](https://developer.x.com/en/docs/twitter-api/tweets/manage-tweets/api-reference)
- [Media Upload API](https://developer.x.com/en/docs/twitter-api/v1/media/upload-media/api-reference/post-media-upload)
- [Rate Limits](https://developer.x.com/en/docs/twitter-api/rate-limits)
- [Parent Spec: SOCIAL_MEDIA_INTEGRATION.md](./SOCIAL_MEDIA_INTEGRATION.md)
