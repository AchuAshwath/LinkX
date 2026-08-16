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


def _build_success_transport(calls: list[dict[str, Any]]) -> httpx.MockTransport:
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
            return httpx.Response(
                200,
                json={
                    "value": {
                        "uploadUrl": "https://media.licdn.com/upload/blob123",
                        "image": "urn:li:image:img_abc_123",
                    }
                },
            )
        if "https://media.licdn.com/upload/blob123" in url_str:
            return httpx.Response(201)
        if "/posts" in url_str:
            return httpx.Response(
                201,
                headers={"x-restli-id": "urn:li:share:final_post_456"},
                json={"id": "urn:li:share:final_post_456"},
            )
        return httpx.Response(404)

    return httpx.MockTransport(handler)


def _mock_async_client_transport(monkeypatch: pytest.MonkeyPatch, handler: Any) -> None:
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.services.linkedin_posts.httpx.AsyncClient",
        lambda *args, **kwargs: _ORIGINAL_ASYNC_CLIENT(
            *args,
            transport=transport,
            **{k: v for k, v in kwargs.items() if k != "transport"},
        ),
    )


@pytest.mark.anyio
async def test_create_image_post_success(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []
    transport = _build_success_transport(calls)
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
        if "https://upload.url" in url_str:
            return httpx.Response(200)
        if "/posts" in url_str:
            return httpx.Response(
                201,
                headers={"x-restli-id": "urn:li:ugcPost:999"},
            )
        return httpx.Response(404)

    _mock_async_client_transport(monkeypatch, handler)

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
@pytest.mark.parametrize(
    (
        "init_status",
        "upload_status",
        "post_status",
        "expected_code",
        "expected_retryable",
    ),
    [
        (500, 200, 201, "linkedin_image_init_failed", True),
        (200, 500, 201, "linkedin_image_upload_failed", True),
        (200, 200, 400, "linkedin_publish_failed", False),
    ],
)
async def test_create_image_post_pipeline_failures(
    monkeypatch: pytest.MonkeyPatch,
    init_status: int,
    upload_status: int,
    post_status: int,
    expected_code: str,
    expected_retryable: bool,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "initializeUpload" in url:
            if init_status >= 400:
                return httpx.Response(init_status, json={"message": "fail"})
            return httpx.Response(
                200,
                json={
                    "value": {
                        "uploadUrl": "https://upload.test",
                        "image": "urn:li:image:1",
                    }
                },
            )
        if "https://upload.test" in url:
            return httpx.Response(upload_status)
        if "/posts" in url:
            return httpx.Response(post_status, json={"message": "fail"})
        return httpx.Response(404)

    _mock_async_client_transport(monkeypatch, handler)
    client = LinkedInPostClient()
    with pytest.raises(LinkedInPostError) as exc:
        await client.create_image_post(
            text="Pipeline error test",
            image_bytes=b"bytes",
            content_type="image/png",
            token="tok",
            sub="sub1",
        )
    assert exc.value.code == expected_code
    assert exc.value.retryable is expected_retryable
