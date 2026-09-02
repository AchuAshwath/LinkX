import uuid
from typing import Any

import pytest
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
    res = client.post(
        f"{settings.API_V1_STR}/ai/threads/", headers=headers, json=payload
    )
    return res.json()


def test_create_chat_thread_with_prompt(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    res = _create_thread_api(
        client, superuser_token_headers, prompt="Write a tweet about React 19"
    )
    assert res["origin"] == "manual"
    assert "React 19" in res["title"]
    assert res["message_count"] == 1
    assert len(res["transcript"]["messages"]) == 1
    assert res["transcript"]["messages"][0]["role"] == "user"


def test_create_chat_thread_no_prompt(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    res = _create_thread_api(client, superuser_token_headers, origin="composer")
    assert res["title"] == "New conversation"
    assert res["message_count"] == 0
    assert res["transcript"]["messages"] == []


def test_list_chat_threads(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    create_random_chat_thread(db)
    create_random_chat_thread(db)
    res = client.get(
        f"{settings.API_V1_STR}/ai/threads/", headers=superuser_token_headers
    )
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["data"], list)
    assert data["count"] >= 2


def test_list_chat_threads_archived_filter(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    t = _create_thread_api(client, superuser_token_headers, prompt="Archived target")
    tid = t["id"]

    client.patch(
        f"{settings.API_V1_STR}/ai/threads/{tid}",
        headers=superuser_token_headers,
        json={"is_archived": True},
    )

    for archived_val, should_contain in ((True, True), (False, False)):
        res = client.get(
            f"{settings.API_V1_STR}/ai/threads/?archived={str(archived_val).lower()}",
            headers=superuser_token_headers,
        )
        assert (tid in [x["id"] for x in res.json()["data"]]) is should_contain


def test_get_chat_thread_detail(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    t = _create_thread_api(client, superuser_token_headers, prompt="Detail target")
    tid = t["id"]

    res = client.get(
        f"{settings.API_V1_STR}/ai/threads/{tid}", headers=superuser_token_headers
    )
    assert res.status_code == 200
    assert res.json()["id"] == tid
    assert "transcript" in res.json()


@pytest.mark.parametrize("method", ["get", "delete", "post"])
def test_chat_thread_not_found(
    client: TestClient, superuser_token_headers: dict[str, str], method: str
) -> None:
    fake_id = uuid.uuid4()
    url = f"{settings.API_V1_STR}/ai/threads/{fake_id}"
    if method == "post":
        res = client.post(
            f"{url}/chat", headers=superuser_token_headers, json={"message": "hi"}
        )
    elif method == "delete":
        res = client.delete(url, headers=superuser_token_headers)
    else:
        res = client.get(url, headers=superuser_token_headers)
    assert res.status_code == 404


@pytest.mark.parametrize("action", ["get", "delete", "chat"])
def test_chat_thread_permission_denied_for_non_owner(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    action: str,
) -> None:
    t = _create_thread_api(
        client, superuser_token_headers, prompt="Private admin thread"
    )
    tid = t["id"]
    url = f"{settings.API_V1_STR}/ai/threads/{tid}"

    if action == "chat":
        res = client.post(
            f"{url}/chat",
            headers=normal_user_token_headers,
            json={"message": "inject"},
        )
    elif action == "delete":
        res = client.delete(url, headers=normal_user_token_headers)
    else:
        res = client.get(url, headers=normal_user_token_headers)

    assert res.status_code == 403
    assert "Not enough permissions" in res.json()["detail"]


def test_update_chat_thread_title(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    t = _create_thread_api(client, superuser_token_headers, prompt="Original title")
    tid = t["id"]

    res = client.patch(
        f"{settings.API_V1_STR}/ai/threads/{tid}",
        headers=superuser_token_headers,
        json={"title": "Renamed Title"},
    )
    assert res.status_code == 200
    assert res.json()["title"] == "Renamed Title"


def test_archive_and_unarchive_chat_thread(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    t = _create_thread_api(client, superuser_token_headers, prompt="Archive toggle")
    tid = t["id"]

    for state in (True, False):
        res = client.patch(
            f"{settings.API_V1_STR}/ai/threads/{tid}",
            headers=superuser_token_headers,
            json={"is_archived": state},
        )
        assert res.status_code == 200
        assert res.json()["is_archived"] is state


def test_delete_chat_thread(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    t = _create_thread_api(client, superuser_token_headers, prompt="Delete target")
    tid = t["id"]

    res = client.delete(
        f"{settings.API_V1_STR}/ai/threads/{tid}", headers=superuser_token_headers
    )
    assert res.status_code == 200
    assert res.json()["message"] == "Chat thread deleted successfully"

    assert (
        client.get(
            f"{settings.API_V1_STR}/ai/threads/{tid}",
            headers=superuser_token_headers,
        ).status_code
        == 404
    )


def test_chat_stream_returns_sse_and_persists(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    t = _create_thread_api(client, superuser_token_headers, origin="composer")
    tid = t["id"]

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
    assert "event: done" in text

    detail = client.get(
        f"{settings.API_V1_STR}/ai/threads/{tid}",
        headers=superuser_token_headers,
    ).json()
    assert detail["message_count"] == 2
    assert (
        detail["transcript"]["messages"][0]["parts"][0]["text"]
        == "Write a post about TypeScript 5.8"
    )


@pytest.mark.parametrize("invalid_title", ["", "     "])
def test_update_chat_thread_invalid_title(
    client: TestClient, superuser_token_headers: dict[str, str], invalid_title: str
) -> None:
    t = _create_thread_api(client, superuser_token_headers, prompt="Valid initial")
    tid = t["id"]

    res = client.patch(
        f"{settings.API_V1_STR}/ai/threads/{tid}",
        headers=superuser_token_headers,
        json={"title": invalid_title},
    )
    assert res.status_code == 422


def test_create_chat_thread_post_id_forbidden(
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

    res = client.post(
        f"{settings.API_V1_STR}/ai/threads/",
        headers=normal_user_token_headers,
        json={"origin": "manual", "prompt": "Exploit", "post_id": str(p.id)},
    )
    assert res.status_code == 403


def test_create_chat_thread_post_id_not_found(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    res = client.post(
        f"{settings.API_V1_STR}/ai/threads/",
        headers=normal_user_token_headers,
        json={
            "origin": "manual",
            "prompt": "Exploit",
            "post_id": str(uuid.uuid4()),
        },
    )
    assert res.status_code == 404


def test_create_chat_thread_multiline_whitespace_prompt(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    res = _create_thread_api(
        client,
        superuser_token_headers,
        prompt="\n\n   \n   Actual first non-empty line of content\nSecond line",
    )
    assert res["title"] == "Actual first non-empty line of content"
