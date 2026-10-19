import base64
import io
import json
import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import settings
from app.services.ai_observation_budget import ObservationInputBudget


def _create_observation_thread(
    *, client: TestClient, headers: dict[str, str]
) -> dict[str, Any]:
    response = client.post(
        f"{settings.API_V1_STR}/ai/threads/",
        headers=headers,
        json={"origin": "composer"},
    )
    return response.json()


def _jpeg_data_url() -> str:
    image = io.BytesIO()
    Image.new("RGB", (1, 1), (255, 0, 0)).save(image, format="JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(image.getvalue()).decode()


def _observation_packet(*, frame: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "session_id": str(uuid.uuid4()),
        "source_epoch": 1,
        "revision": 1,
        "captured_at": now,
        "delivered_at": now,
        "frame_presented_at_ms": None,
        "width": 1,
        "height": 1,
        "image_data_url": frame,
    }


def test_observation_chat_stream_does_not_persist_frame(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    frame = _jpeg_data_url()
    thread = _create_observation_thread(client=client, headers=superuser_token_headers)
    packet = _observation_packet(frame=frame)

    async def fake_direct_stream(**kwargs: Any):
        assert kwargs["model_name"] == settings.VISION_AI_MODEL
        content = kwargs["messages"][1]["content"]
        assert content[1]["image_url"]["url"] == frame
        yield "A red square."

    budget = ObservationInputBudget(
        model_id="gpt-5.6-luna",
        model_input_capacity=11_200,
        output_reserve=1200,
        input_limit=10_000,
        estimated_input_tokens=77,
    )
    with (
        patch(
            "app.services.ai_chat_runner.stream_direct_openai_proxy", fake_direct_stream
        ),
        patch(
            "app.services.ai_chat_runner.budget_observation_messages",
            return_value=budget,
        ),
        patch("app.services.agentic.agent_supervisor.build_bot_agent") as supervisor,
        patch(
            "app.api.routes.ai_threads.generate_ai_thread_title", return_value=None
        ) as generate_title,
    ):
        response = client.post(
            f"{settings.API_V1_STR}/ai/threads/{thread['id']}/chat",
            headers=superuser_token_headers,
            json={"message": "What is visible?", "observation": packet},
        )

    assert response.status_code == 200
    assert "event: observation_usage" in response.text
    usage_event = next(
        chunk
        for chunk in response.text.split("\n\n")
        if "event: observation_usage" in chunk
    )
    usage_data = json.loads(usage_event.split("data: ", 1)[1])
    assert usage_data["frame_count"] == 1
    assert usage_data["history_frames"] == 0
    assert usage_data["revision"] == 1
    assert usage_data["source_epoch"] == 1
    assert isinstance(usage_data["captured_at"], str)
    assert isinstance(usage_data["delivered_at"], str)
    assert "session_id" not in usage_data
    assert "event: error" not in response.text
    assert '"square."' in response.text
    supervisor.assert_not_called()
    generate_title.assert_not_called()

    detail = client.get(
        f"{settings.API_V1_STR}/ai/threads/{thread['id']}",
        headers=superuser_token_headers,
    ).json()
    serialized = str(detail["transcript"])
    assert frame not in serialized
    assert "What is visible?" in serialized
    assert "observation_usage" not in serialized
    assert "estimated_input_tokens" not in serialized


def test_invalid_observation_validation_does_not_echo_image_data(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    thread = _create_observation_thread(client=client, headers=superuser_token_headers)
    marker = "PRIVATE_FRAME_MARKER"
    response = client.post(
        f"{settings.API_V1_STR}/ai/threads/{thread['id']}/chat",
        headers=superuser_token_headers,
        json={
            "message": "What is visible?",
            "observation": {
                "session_id": str(uuid.uuid4()),
                "source_epoch": 1,
                "revision": 1,
                "captured_at": datetime.now(timezone.utc).isoformat(),
                "delivered_at": datetime.now(timezone.utc).isoformat(),
                "frame_presented_at_ms": None,
                "width": 1,
                "height": 1,
                "image_data_url": f"data:image/jpeg;base64,{marker}",
            },
        },
    )

    assert response.status_code == 422
    assert marker not in response.text
