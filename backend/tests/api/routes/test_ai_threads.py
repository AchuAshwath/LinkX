import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessageChunk
from sqlmodel import Session, select

from app.core.config import settings
from app.models import Post, User
from tests.utils.chat_thread import create_random_chat_thread


def _create_thread(
    client: TestClient,
    headers: dict[str, str],
    *,
    prompt: str | None = None,
    origin: str = "manual",
) -> dict[str, Any]:
    body: dict[str, Any] = {"origin": origin}
    if prompt is not None:
        body["prompt"] = prompt
    response = client.post(
        f"{settings.API_V1_STR}/ai/threads/", headers=headers, json=body
    )
    return response.json()


def test_create_chat_thread_variations(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    # 1. With standard prompt
    res1 = _create_thread(
        client, superuser_token_headers, prompt="Write a tweet about React 19"
    )
    assert res1["origin"] == "manual"
    assert res1["message_count"] == 0
    assert len(res1["transcript"]["messages"]) == 0

    # 2. Without prompt
    res2 = _create_thread(client, superuser_token_headers, origin="composer")
    assert res2["title"] == "New conversation"
    assert res2["message_count"] == 0
    assert res2["transcript"]["messages"] == []

    # 3. Multiline with leading blank lines
    res3 = _create_thread(
        client,
        superuser_token_headers,
        prompt="\n\n   \n   First actual content line\nSecond line",
    )
    assert res3["title"] == "First actual content line"


def test_chat_thread_crud_and_archive_lifecycle(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    # 1. Create
    thread = _create_thread(client, superuser_token_headers, prompt="Lifecycle test")
    tid = thread["id"]

    # 2. Get Detail
    get_res = client.get(
        f"{settings.API_V1_STR}/ai/threads/{tid}",
        headers=superuser_token_headers,
    )
    assert get_res.status_code == 200
    assert get_res.json()["id"] == tid
    assert "transcript" in get_res.json()

    # 3. Update title
    rename_res = client.patch(
        f"{settings.API_V1_STR}/ai/threads/{tid}",
        headers=superuser_token_headers,
        json={"title": "Updated Title"},
    )
    assert rename_res.status_code == 200
    assert rename_res.json()["title"] == "Updated Title"

    # 4. Reject blank title
    for bad_title in ("", "     "):
        err_res = client.patch(
            f"{settings.API_V1_STR}/ai/threads/{tid}",
            headers=superuser_token_headers,
            json={"title": bad_title},
        )
        assert err_res.status_code == 422

    # 5. Toggle archive
    for is_archived in (True, False):
        arch_res = client.patch(
            f"{settings.API_V1_STR}/ai/threads/{tid}",
            headers=superuser_token_headers,
            json={"is_archived": is_archived},
        )
        assert arch_res.status_code == 200
        assert arch_res.json()["is_archived"] is is_archived

    # 6. Delete
    del_res = client.delete(
        f"{settings.API_V1_STR}/ai/threads/{tid}",
        headers=superuser_token_headers,
    )
    assert del_res.status_code == 200
    assert del_res.json()["message"] == "Chat thread deleted successfully"

    # 7. Confirm 404
    assert (
        client.get(
            f"{settings.API_V1_STR}/ai/threads/{tid}",
            headers=superuser_token_headers,
        ).status_code
        == 404
    )


def test_list_chat_threads_and_filtering(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    create_random_chat_thread(db)
    target = _create_thread(client, superuser_token_headers, prompt="Target thread")
    tid = target["id"]

    client.patch(
        f"{settings.API_V1_STR}/ai/threads/{tid}",
        headers=superuser_token_headers,
        json={"is_archived": True},
    )

    arch_res = client.get(
        f"{settings.API_V1_STR}/ai/threads/?archived=true",
        headers=superuser_token_headers,
    )
    assert arch_res.status_code == 200
    assert tid in [x["id"] for x in arch_res.json()["data"]]

    act_res = client.get(
        f"{settings.API_V1_STR}/ai/threads/?archived=false",
        headers=superuser_token_headers,
    )
    assert act_res.status_code == 200
    assert tid not in [x["id"] for x in act_res.json()["data"]]


@pytest.mark.parametrize("action", ["get", "delete", "chat"])
def test_chat_thread_permissions_and_not_found(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    action: str,
) -> None:
    # 1. 404 for missing thread
    fake_id = uuid.uuid4()
    missing_url = f"{settings.API_V1_STR}/ai/threads/{fake_id}"
    if action == "chat":
        res_404 = client.post(
            f"{missing_url}/chat",
            headers=superuser_token_headers,
            json={"message": "hi"},
        )
    elif action == "delete":
        res_404 = client.delete(missing_url, headers=superuser_token_headers)
    else:
        res_404 = client.get(missing_url, headers=superuser_token_headers)
    assert res_404.status_code == 404

    # 2. 403 for non-owner access
    admin_thread = _create_thread(
        client, superuser_token_headers, prompt="Admin restricted"
    )
    admin_url = f"{settings.API_V1_STR}/ai/threads/{admin_thread['id']}"
    if action == "chat":
        res_403 = client.post(
            f"{admin_url}/chat",
            headers=normal_user_token_headers,
            json={"message": "intrude"},
        )
    elif action == "delete":
        res_403 = client.delete(admin_url, headers=normal_user_token_headers)
    else:
        res_403 = client.get(admin_url, headers=normal_user_token_headers)
    assert res_403.status_code == 403


def test_create_chat_thread_post_id_validation(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    superuser = db.exec(select(User).where(User.is_superuser == True)).first()  # noqa: E712
    assert superuser is not None

    p = Post(
        owner_id=superuser.id,
        content="Secret",
        platform="linkedin",
        status="draft",
    )
    db.add(p)
    db.commit()
    db.refresh(p)

    forbidden_res = client.post(
        f"{settings.API_V1_STR}/ai/threads/",
        headers=normal_user_token_headers,
        json={"origin": "manual", "prompt": "Exploit", "post_id": str(p.id)},
    )
    assert forbidden_res.status_code == 403

    not_found_res = client.post(
        f"{settings.API_V1_STR}/ai/threads/",
        headers=normal_user_token_headers,
        json={"origin": "manual", "prompt": "Exploit", "post_id": str(uuid.uuid4())},
    )
    assert not_found_res.status_code == 404


def test_chat_stream_returns_sse_and_persists(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    async def fake_astream(messages: Any):  # noqa: ARG001
        yield AIMessageChunk(
            content="<thought>Strategy: TypeScript 5.8 update</thought>\nTypeScript 5.8 brings "
        )
        yield AIMessageChunk(content="major performance upgrades!")

    mock_model = MagicMock()
    mock_model.astream = fake_astream

    t = _create_thread(client, superuser_token_headers, origin="composer")
    tid = t["id"]

    with (
        patch(
            "app.services.ai_completion_client.stream_direct_openai_proxy",
            side_effect=ConnectionError("proxy down"),
        ),
        patch(
            "app.services.ai_completion_client.get_chat_model",
            return_value=mock_model,
        ),
    ):
        stream_res = client.post(
            f"{settings.API_V1_STR}/ai/threads/{tid}/chat",
            headers=superuser_token_headers,
            json={"message": "Write a post about TypeScript 5.8"},
        )
    assert stream_res.status_code == 200
    assert "text/event-stream" in stream_res.headers["content-type"]
    text = stream_res.text
    assert "event: thought" in text
    assert "event: text_delta" in text
    assert '"TypeScript "' in text
    assert '"upgrades!"' in text
    assert "event: done" in text

    detail = client.get(
        f"{settings.API_V1_STR}/ai/threads/{tid}",
        headers=superuser_token_headers,
    ).json()
    assert detail["message_count"] == 2
    assert "TypeScript 5.8" in detail["title"]
    assert detail["title"] != "New conversation"
    assert (
        detail["transcript"]["messages"][0]["parts"][0]["text"]
        == "Write a post about TypeScript 5.8"
    )
    assert (
        detail["transcript"]["messages"][1]["parts"][1]["text"]
        == "TypeScript 5.8 brings major performance upgrades!"
    )


def test_list_ai_models(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    res = client.get(
        f"{settings.API_V1_STR}/ai/threads/models",
        headers=superuser_token_headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert "data" in data
    assert "default_model" in data
    assert len(data["data"]) > 0
    assert any(m["id"] == "gemini-3.6-flash-high" for m in data["data"])


def test_chat_stream_with_multimodal_images_persists(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    async def fake_astream(messages: Any):  # noqa: ARG001
        # Check that the last message content was parsed into multimodal list
        last = messages[-1]
        assert isinstance(last.content, list)
        assert last.content[0]["text"] == "Analyze this chart"
        assert "data:image/png;base64" in last.content[1]["image_url"]["url"]
        yield AIMessageChunk(content="This chart shows 40% growth!")

    mock_model = MagicMock()
    mock_model.astream = fake_astream

    t = _create_thread(client, superuser_token_headers, origin="composer")
    tid = t["id"]

    with (
        patch(
            "app.services.ai_completion_client.stream_direct_openai_proxy",
            side_effect=ConnectionError("proxy down"),
        ),
        patch(
            "app.services.ai_completion_client.get_chat_model",
            return_value=mock_model,
        ),
    ):
        stream_res = client.post(
            f"{settings.API_V1_STR}/ai/threads/{tid}/chat",
            headers=superuser_token_headers,
            json={
                "message": "Analyze this chart",
                "images": [
                    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
                ],
            },
        )
    assert stream_res.status_code == 200
    assert "text/event-stream" in stream_res.headers["content-type"]
    assert "growth!" in stream_res.text

    detail = client.get(
        f"{settings.API_V1_STR}/ai/threads/{tid}",
        headers=superuser_token_headers,
    ).json()
    user_parts = detail["transcript"]["messages"][0]["parts"]
    assert len(user_parts) == 2
    assert user_parts[0] == {"type": "text", "text": "Analyze this chart"}
    assert user_parts[1]["type"] == "image_url"
    assert "data:image/png;base64" in user_parts[1]["image_url"]["url"]
