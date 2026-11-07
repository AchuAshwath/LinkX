"""Live selected-model smoke through the real browser-chat endpoint, synthetic notes only.

Run from backend: uv run --no-sync python -m scripts.observation_lab.streaming_endpoint_smoke
The normal host app must be running on 8000. Temporary accounts/threads are removed.
"""

from __future__ import annotations

import json
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx

from app.core.config import settings

OUTPUT = (
    Path(__file__).resolve().parents[3]
    / "docs/observation/streaming-live-endpoint-result.json"
)


def login(*, client: httpx.Client, email: str, password: str) -> dict[str, str]:
    response = client.post(
        "/api/v1/login/access-token", data={"username": email, "password": password}
    )
    response.raise_for_status()
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@contextmanager
def fixture(*, client: httpx.Client):
    admin = login(
        client=client,
        email=settings.FIRST_SUPERUSER,
        password=settings.FIRST_SUPERUSER_PASSWORD,
    )
    email, password = f"streaming-189-{uuid4().hex}@example.com", uuid4().hex
    user = client.post(
        "/api/v1/users/signup",
        json={
            "email": email,
            "password": password,
            "full_name": "Streaming endpoint fixture",
        },
    )
    user.raise_for_status()
    thread_id = None
    try:
        headers = login(client=client, email=email, password=password)
        response = client.post(
            "/api/v1/ai/threads/",
            headers=headers,
            json={
                "prompt": "Synthetic streaming acceptance",
                "model": settings.AI_MODEL,
            },
        )
        response.raise_for_status()
        thread_id = response.json()["id"]
        yield headers, thread_id
    finally:
        if thread_id:
            client.delete(
                f"/api/v1/ai/threads/{thread_id}", headers=headers
            ).raise_for_status()
        client.delete(
            f"/api/v1/users/{user.json()['id']}", headers=admin
        ).raise_for_status()


def payload() -> dict[str, Any]:
    return {
        "request_id": str(uuid4()),
        "model": settings.AI_MODEL,
        "message": "Summarize the shared launch note in about 100 words, including its access code, shipment date, and uncertainty. Use only the supplied reference. No tools are needed.",
        "browser_context": {
            "session_id": str(uuid4()),
            "generation": 1,
            "cutoff": 1,
            "summary": "",
            "pending_frames": [],
            "current_view": None,
            "gap_count": 0,
            "notes": [
                {
                    "id": "live-only-note",
                    "sequence": 1,
                    "model": settings.AI_MODEL,
                    "text": "Synthetic launch note: project Harbor is shipping its first desktop edition on 3 November 2026. The access code is SAPPHIRE-742. The desktop edition includes searchable workspaces and shared draft review. Mobile delivery has not been announced. The team has not confirmed the next release date.",
                    "uncertainty": "Mobile availability and the next release date are unconfirmed.",
                }
            ],
        },
    }


def consume(*, response: httpx.Response, started: float) -> list[dict[str, Any]]:
    response.raise_for_status()
    events = []
    event = ""
    for line in response.iter_lines():
        if line.startswith("event: "):
            event = line.removeprefix("event: ")
        elif line.startswith("data: "):
            events.append(
                {
                    "event": event,
                    "at_ms": round((time.monotonic() - started) * 1000),
                    "data": json.loads(line.removeprefix("data: ")),
                }
            )
    return events


def verify(
    *, client: httpx.Client, headers: dict[str, str], thread_id: str
) -> dict[str, Any]:
    started = time.monotonic()
    with client.stream(
        "POST",
        f"/api/v1/ai/threads/{thread_id}/browser-chat",
        headers=headers,
        json=payload(),
    ) as response:
        events = consume(response=response, started=started)
    chunks, done = verify_events(events=events)
    saved = client.get(f"/api/v1/ai/threads/{thread_id}", headers=headers).json()
    assert [message["role"] for message in saved["transcript"]["messages"]] == [
        "user",
        "assistant",
    ]
    assert "live-only-note" not in json.dumps(saved["transcript"])
    return {
        "passed": True,
        "model": settings.AI_MODEL,
        "scope": "Real browser-chat endpoint and normal selected-model agent, synthetic text notes; no screenshot accuracy claim",
        "answer_chunks": len(chunks),
        "first_answer_ms": chunks[0]["at_ms"],
        "last_answer_ms": chunks[-1]["at_ms"],
        "done_ms": done[0]["at_ms"],
        "event_timing": [
            {"event": event["event"], "at_ms": event["at_ms"]} for event in events
        ],
        "required_facts_present": True,
        "one_saved_turn_pair": True,
    }


def verify_events(
    *, events: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    chunks = [event for event in events if event["event"] == "text_delta"]
    done = [event for event in events if event["event"] == "done"]
    errors = [event for event in events if event["event"] == "error"]
    if errors:
        raise AssertionError(f"Live endpoint error: {errors[0]['data'].get('message')}")
    assert len(chunks) >= 2, "Need actual incremental answer chunks"
    assert len(done) == 1
    assert chunks[0]["at_ms"] < chunks[-1]["at_ms"] <= done[0]["at_ms"]
    answer = "".join(chunk["data"]["content"] for chunk in chunks)
    assert "SAPPHIRE-742" in answer and "3 November" in answer
    return chunks, done


def main() -> None:
    result: dict[str, Any] = {
        "passed": False,
        "date": datetime.now(timezone.utc).isoformat(),
    }
    try:
        with httpx.Client(base_url="http://127.0.0.1:8000", timeout=120) as client:
            with fixture(client=client) as (headers, thread_id):
                result.update(
                    verify(client=client, headers=headers, thread_id=thread_id)
                )
    except Exception as error:
        result["error"] = str(error)
        raise
    finally:
        OUTPUT.write_text(json.dumps(result, indent=2) + "\n")
        print(
            json.dumps(
                {key: value for key, value in result.items() if key != "event_timing"}
            )
        )


if __name__ == "__main__":
    main()
