import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import Post, User
from tests.utils.chat_thread import create_random_chat_thread


def _create_thread_api(
    client: TestClient,
    headers: dict[str, str],
    *,
    prompt: str | None = None,
    origin: str = "manual",
    post_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"origin": origin}
    if prompt is not None:
        payload["prompt"] = prompt
    if post_id is not None:
        payload["post_id"] = post_id
    response = client.post(
        f"{settings.API_V1_STR}/ai/threads/",
        headers=headers,
        json=payload,
    )
    return response.json()


def test_create_chat_thread_with_prompt(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    content = _create_thread_api(
        client,
        superuser_token_headers,
        prompt="Write a viral tweet about React 19 architecture",
    )
    assert content["origin"] == "manual"
    assert "React 19" in content["title"]
    assert content["message_count"] == 1
    assert "id" in content
    assert "owner_id" in content
    assert content["is_archived"] is False
    assert len(content["transcript"]["messages"]) == 1
    assert content["transcript"]["messages"][0]["role"] == "user"


def test_create_chat_thread_no_prompt(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    content = _create_thread_api(
        client,
        superuser_token_headers,
        origin="composer",
    )
    assert content["title"] == "New conversation"
    assert content["message_count"] == 0
    assert content["transcript"]["messages"] == []


def test_list_chat_threads(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    create_random_chat_thread(db)
    create_random_chat_thread(db)
    response = client.get(
        f"{settings.API_V1_STR}/ai/threads/",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    content = response.json()
    assert "data" in content
    assert "count" in content
    assert isinstance(content["data"], list)


def test_list_chat_threads_archived_filter(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    thread = _create_thread_api(
        client, superuser_token_headers, prompt="Thread to be archived"
    )
    thread_id = thread["id"]

    client.patch(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}",
        headers=superuser_token_headers,
        json={"is_archived": True},
    )

    res_archived = client.get(
        f"{settings.API_V1_STR}/ai/threads/?archived=true",
        headers=superuser_token_headers,
    )
    assert res_archived.status_code == 200
    archived_ids = [t["id"] for t in res_archived.json()["data"]]
    assert thread_id in archived_ids

    res_active = client.get(
        f"{settings.API_V1_STR}/ai/threads/?archived=false",
        headers=superuser_token_headers,
    )
    assert res_active.status_code == 200
    active_ids = [t["id"] for t in res_active.json()["data"]]
    assert thread_id not in active_ids


def test_get_chat_thread(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    thread = _create_thread_api(
        client, superuser_token_headers, prompt="Detailed discussion"
    )
    thread_id = thread["id"]

    response = client.get(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["id"] == thread_id
    assert "transcript" in content
    assert len(content["transcript"]["messages"]) == 1


def test_get_chat_thread_not_found(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/ai/threads/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Chat thread not found"


def test_get_chat_thread_not_owner(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
) -> None:
    thread = _create_thread_api(
        client, superuser_token_headers, prompt="Private admin thread"
    )
    thread_id = thread["id"]

    response = client.get(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Not enough permissions"


def test_update_chat_thread_title(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    thread = _create_thread_api(
        client, superuser_token_headers, prompt="Original title prompt"
    )
    thread_id = thread["id"]

    response = client.patch(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}",
        headers=superuser_token_headers,
        json={"title": "Renamed Thread Title"},
    )
    assert response.status_code == 200
    content = response.json()
    assert content["title"] == "Renamed Thread Title"


def test_archive_and_unarchive_chat_thread(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    thread = _create_thread_api(client, superuser_token_headers, prompt="Archive test")
    thread_id = thread["id"]

    res_arch = client.patch(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}",
        headers=superuser_token_headers,
        json={"is_archived": True},
    )
    assert res_arch.status_code == 200
    assert res_arch.json()["is_archived"] is True

    res_unarch = client.patch(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}",
        headers=superuser_token_headers,
        json={"is_archived": False},
    )
    assert res_unarch.status_code == 200
    assert res_unarch.json()["is_archived"] is False


def test_delete_chat_thread(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    thread = _create_thread_api(client, superuser_token_headers, prompt="Delete test")
    thread_id = thread["id"]

    response = client.delete(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["message"] == "Chat thread deleted successfully"

    get_res = client.get(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}",
        headers=superuser_token_headers,
    )
    assert get_res.status_code == 404


def test_delete_chat_thread_not_found(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.delete(
        f"{settings.API_V1_STR}/ai/threads/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 404


def test_delete_chat_thread_not_owner(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
) -> None:
    thread = _create_thread_api(
        client, superuser_token_headers, prompt="Protected thread"
    )
    thread_id = thread["id"]

    response = client.delete(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Not enough permissions"


def test_chat_stream_returns_sse(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    thread = _create_thread_api(client, superuser_token_headers, origin="composer")
    thread_id = thread["id"]

    response = client.post(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}/chat",
        headers=superuser_token_headers,
        json={"message": "Write a post about TypeScript 5.8"},
    )
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    text = response.text
    assert "event: thought" in text
    assert "event: text_delta" in text
    assert "event: done" in text
    assert "TypeScript 5.8" in text


def test_chat_stream_persists_transcript(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    thread = _create_thread_api(client, superuser_token_headers, origin="composer")
    thread_id = thread["id"]

    stream_res = client.post(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}/chat",
        headers=superuser_token_headers,
        json={"message": "First user turn"},
    )
    assert stream_res.status_code == 200
    assert "done" in stream_res.text

    get_res = client.get(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}",
        headers=superuser_token_headers,
    )
    assert get_res.status_code == 200
    content = get_res.json()
    assert content["message_count"] == 2
    messages = content["transcript"]["messages"]
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[0]["parts"][0]["text"] == "First user turn"
    assert messages[1]["role"] == "assistant"


def test_chat_stream_thread_not_found(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/ai/threads/{uuid.uuid4()}/chat",
        headers=superuser_token_headers,
        json={"message": "Hello"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Chat thread not found"


def test_update_chat_thread_empty_or_whitespace_title_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    thread = _create_thread_api(
        client, superuser_token_headers, prompt="Valid initial title"
    )
    thread_id = thread["id"]

    res_empty = client.patch(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}",
        headers=superuser_token_headers,
        json={"title": ""},
    )
    assert res_empty.status_code == 422

    res_space = client.patch(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}",
        headers=superuser_token_headers,
        json={"title": "     "},
    )
    assert res_space.status_code == 422


def test_create_chat_thread_post_id_ownership_security(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    superuser = db.exec(select(User).where(User.is_superuser == True)).first()  # noqa: E712
    assert superuser is not None

    post = Post(
        owner_id=superuser.id,
        content="Secret admin draft",
        platform="linkedin",
        status="draft",
    )
    db.add(post)
    db.commit()
    db.refresh(post)

    response = client.post(
        f"{settings.API_V1_STR}/ai/threads/",
        headers=normal_user_token_headers,
        json={
            "origin": "manual",
            "prompt": "Exploit attempt",
            "post_id": str(post.id),
        },
    )
    assert response.status_code == 403
    assert "Cannot link" in response.json()["detail"]

    res_404 = client.post(
        f"{settings.API_V1_STR}/ai/threads/",
        headers=normal_user_token_headers,
        json={
            "origin": "manual",
            "prompt": "Exploit attempt",
            "post_id": str(uuid.uuid4()),
        },
    )
    assert res_404.status_code == 404


def test_create_chat_thread_multiline_whitespace_prompt(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    content = _create_thread_api(
        client,
        superuser_token_headers,
        prompt="\n\n   \n   Actual first non-empty line of content\nSecond line",
    )
    assert content["title"] == "Actual first non-empty line of content"


def test_chat_stream_not_owner_forbidden(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
) -> None:
    thread = _create_thread_api(
        client, superuser_token_headers, prompt="Superuser private chat"
    )
    thread_id = thread["id"]

    response = client.post(
        f"{settings.API_V1_STR}/ai/threads/{thread_id}/chat",
        headers=normal_user_token_headers,
        json={"message": "Unauthorized message injection"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Not enough permissions"
