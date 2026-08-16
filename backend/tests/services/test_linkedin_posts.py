import json
import time
import uuid
from typing import Any

import httpx
import pytest

from app.services.linkedin_posts import (
    LinkedInPostClient,
    LinkedInPostError,
    LinkedInPostResult,
    linkedin_token_redis_key,
)

_ORIGINAL_ASYNC_CLIENT = httpx.AsyncClient


@pytest.mark.anyio
async def test_create_image_post_success(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        calls.append(
            {
                "method": request.method,
                "url": url_str,
                "headers": dict(request.headers),
                "content": request.read(),
            }
        )

        if "images?action=initializeUpload" in url_str:
            assert request.method == "POST"
            assert request.headers.get("linkedin-version") == "202511"
            assert request.headers.get("x-restli-protocol-version") == "2.0.0"
            assert request.headers.get("authorization") == "Bearer test_token"
            body = json.loads(request.read())
            assert body["initializeUploadRequest"]["owner"] == "urn:li:person:sub_123"
            return httpx.Response(
                200,
                json={
                    "value": {
                        "uploadUrl": "https://media.licdn.com/upload/blob123",
                        "image": "urn:li:image:img_abc_123",
                    }
                },
            )
        elif "https://media.licdn.com/upload/blob123" in url_str:
            assert request.method == "PUT"
            assert request.headers.get("content-type") == "image/png"
            assert request.headers.get("authorization") == "Bearer test_token"
            assert request.read() == b"fake_png_bytes"
            return httpx.Response(201)
        elif "/posts" in url_str:
            assert request.method == "POST"
            assert request.headers.get("linkedin-version") == "202511"
            assert request.headers.get("authorization") == "Bearer test_token"
            body = json.loads(request.read())
            assert body["author"] == "urn:li:person:sub_123"
            assert body["commentary"] == "Test image post commentary"
            assert body["content"]["media"]["id"] == "urn:li:image:img_abc_123"
            assert body["content"]["media"]["title"] == "My Custom Title"
            return httpx.Response(
                201,
                headers={"x-restli-id": "urn:li:share:final_post_456"},
                json={"id": "urn:li:share:final_post_456"},
            )

        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.services.linkedin_posts.httpx.AsyncClient",
        lambda *args, **kwargs: _ORIGINAL_ASYNC_CLIENT(
            *args,
            transport=transport,
            **{k: v for k, v in kwargs.items() if k != "transport"},
        ),
    )

    client = LinkedInPostClient()
    result = await client.create_image_post(
        text="Test image post commentary",
        image_bytes=b"fake_png_bytes",
        content_type="image/png",
        title="My Custom Title",
        token="test_token",
        sub="sub_123",
    )

    assert isinstance(result, LinkedInPostResult)
    assert result.post_id == "urn:li:share:final_post_456"
    assert result.image_urn == "urn:li:image:img_abc_123"
    assert len(calls) == 3


@pytest.mark.anyio
async def test_create_image_post_with_user_id_and_redis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = str(uuid.uuid4())
    token_payload = {
        "access_token": "redis_bearer_token",
        "expires_at": time.time() + 3600,
        "token_type": "bearer",
    }

    class MockRedis:
        def get(self, key: str) -> str | None:
            if key == linkedin_token_redis_key(user_id=user_id):
                return json.dumps(token_payload)
            return None

    monkeypatch.setattr("app.services.linkedin_posts.get_redis", lambda: MockRedis())

    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        if "images?action=initializeUpload" in url_str:
            return httpx.Response(
                200,
                json={
                    "value": {
                        "uploadUrl": "https://upload.url",
                        "image": "urn:li:image:img_xyz",
                    }
                },
            )
        elif "https://upload.url" in url_str:
            return httpx.Response(200)
        elif "/posts" in url_str:
            return httpx.Response(
                201,
                headers={"x-restli-id": "urn:li:ugcPost:999"},
            )
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.services.linkedin_posts.httpx.AsyncClient",
        lambda *args, **kwargs: _ORIGINAL_ASYNC_CLIENT(
            *args,
            transport=transport,
            **{k: v for k, v in kwargs.items() if k != "transport"},
        ),
    )

    client = LinkedInPostClient()
    result = await client.create_image_post(
        text="Posted via user_id",
        image_bytes=b"sample_image",
        content_type="image/jpeg",
        user_id=user_id,
        linkedin_person_id="person_456",
    )

    assert result.post_id == "urn:li:ugcPost:999"
    assert result.image_urn == "urn:li:image:img_xyz"


@pytest.mark.anyio
async def test_create_image_post_missing_token_and_sub() -> None:
    client = LinkedInPostClient()
    with pytest.raises(LinkedInPostError) as exc_token:
        await client.create_image_post(
            text="Hello",
            image_bytes=b"bytes",
            content_type="image/png",
            sub="sub_123",
        )
    assert exc_token.value.code == "linkedin_token_missing"

    with pytest.raises(LinkedInPostError) as exc_sub:
        await client.create_image_post(
            text="Hello",
            image_bytes=b"bytes",
            content_type="image/png",
            token="valid_token",
        )
    assert exc_sub.value.code == "linkedin_sub_missing"


@pytest.mark.anyio
async def test_create_image_post_step1_fail(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"message": "LinkedIn server error"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.services.linkedin_posts.httpx.AsyncClient",
        lambda *args, **kwargs: _ORIGINAL_ASYNC_CLIENT(
            *args,
            transport=transport,
            **{k: v for k, v in kwargs.items() if k != "transport"},
        ),
    )

    client = LinkedInPostClient()
    with pytest.raises(LinkedInPostError) as exc:
        await client.create_image_post(
            text="Fail step 1",
            image_bytes=b"bytes",
            content_type="image/png",
            token="tok",
            sub="sub1",
        )
    assert exc.value.code == "linkedin_image_init_failed"
    assert exc.value.retryable is True


@pytest.mark.anyio
async def test_create_image_post_step2_binary_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "initializeUpload" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "value": {
                        "uploadUrl": "https://upload.fail",
                        "image": "urn:li:image:img_1",
                    }
                },
            )
        return httpx.Response(500)

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.services.linkedin_posts.httpx.AsyncClient",
        lambda *args, **kwargs: _ORIGINAL_ASYNC_CLIENT(
            *args,
            transport=transport,
            **{k: v for k, v in kwargs.items() if k != "transport"},
        ),
    )

    client = LinkedInPostClient()
    with pytest.raises(LinkedInPostError) as exc:
        await client.create_image_post(
            text="Fail step 2",
            image_bytes=b"bytes",
            content_type="image/png",
            token="tok",
            sub="sub1",
        )
    assert exc.value.code == "linkedin_image_upload_failed"
    assert exc.value.retryable is True


@pytest.mark.anyio
async def test_create_image_post_step3_post_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "initializeUpload" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "value": {
                        "uploadUrl": "https://upload.ok",
                        "image": "urn:li:image:img_1",
                    }
                },
            )
        if "https://upload.ok" in str(request.url):
            return httpx.Response(200)
        return httpx.Response(400, json={"message": "Invalid post schema"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.services.linkedin_posts.httpx.AsyncClient",
        lambda *args, **kwargs: _ORIGINAL_ASYNC_CLIENT(
            *args,
            transport=transport,
            **{k: v for k, v in kwargs.items() if k != "transport"},
        ),
    )

    client = LinkedInPostClient()
    with pytest.raises(LinkedInPostError) as exc:
        await client.create_image_post(
            text="Fail step 3",
            image_bytes=b"bytes",
            content_type="image/png",
            token="tok",
            sub="sub1",
        )
    assert exc.value.code == "linkedin_publish_failed"
    assert exc.value.retryable is False
