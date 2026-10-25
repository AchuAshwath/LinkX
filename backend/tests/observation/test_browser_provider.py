import asyncio
import base64
import io
import json
from datetime import datetime, timezone
from typing import Any
from unittest.mock import patch
from uuid import uuid4

import httpx
import pytest
from PIL import Image

from app.observation.model import (
    BrowserModel,
    DirectOpenAIProvider,
    ObservationModelError,
    ProviderConfig,
)
from app.observation.schemas import BrowserFrame, ReadRequest


def _frame(*, frame_id: str = "opaque-frame-7", sequence: int = 7) -> BrowserFrame:
    image = io.BytesIO()
    color = (sequence % 255, (sequence * 3) % 255, (sequence * 7) % 255)
    Image.new("RGB", (1, 1), color).save(image, format="JPEG")
    encoded = base64.b64encode(image.getvalue()).decode("ascii")
    return BrowserFrame(
        id=frame_id,
        sequence=sequence,
        captured_at=datetime.now(timezone.utc),
        width=1,
        height=1,
        image_data_url=f"data:image/jpeg;base64,{encoded}",
    )


@pytest.mark.anyio
async def test_direct_provider_parses_only_message_content_without_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.config import settings

    monkeypatch.setattr(
        settings, "OPENAI_API_COMPATIBLE_API_KEY", "test-observation-key"
    )
    request = ReadRequest(operation_id=uuid4(), model="vision-model", frame=_frame())
    seen: dict[str, Any] = {}

    def respond(http_request: httpx.Request) -> httpx.Response:
        seen["url"] = str(http_request.url)
        seen["authorization"] = http_request.headers["Authorization"]
        seen["payload"] = json.loads(http_request.content)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {"text": "A visible menu.", "uncertainty": ""}
                            ),
                            "reasoning_content": '{"text":"wrong"}',
                        }
                    }
                ]
            },
        )

    provider = DirectOpenAIProvider(transport=httpx.MockTransport(respond))
    with (
        patch(
            "litellm.get_model_info",
            return_value={
                "max_input_tokens": 10_000,
                "max_output_tokens": 2_000,
                "supports_vision": True,
            },
        ),
        patch("litellm.token_counter", return_value=100),
    ):
        note = await BrowserModel(provider=provider).read(request=request)

    assert note.text == "A visible menu."
    assert seen["url"] == "http://127.0.0.1:8317/v1/chat/completions"
    assert seen["authorization"] == "Bearer test-observation-key"
    assert seen["payload"]["stream"] is False
    response_format = seen["payload"]["response_format"]
    schema = response_format["json_schema"]
    assert schema["strict"] is True
    assert schema["schema"]["additionalProperties"] is False
    assert schema["schema"]["required"] == ["text", "uncertainty"]
    assert schema["schema"]["properties"]["text"]["minLength"] == 1
    assert schema["schema"]["properties"]["text"]["pattern"] == r"\S"
    assert all(
        "default" not in field for field in schema["schema"]["properties"].values()
    )


@pytest.mark.anyio
async def test_provider_http_error_does_not_expose_response_body() -> None:
    private_body = "PROVIDER_PRIVATE_RESPONSE_BODY"

    def respond(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text=private_body)

    provider = DirectOpenAIProvider(transport=httpx.MockTransport(respond))

    with pytest.raises(ObservationModelError) as error:
        await provider(
            config=ProviderConfig(base_url="https://provider.invalid/v1", api_key="k"),
            payload={"model": "m", "messages": []},
        )

    assert private_body not in str(error.value)


@pytest.mark.anyio
async def test_provider_rejects_truncated_json_even_when_content_parses() -> None:
    def respond(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "length",
                        "message": {"content": json.dumps({"text": "partial"})},
                    }
                ]
            },
        )

    provider = DirectOpenAIProvider(transport=httpx.MockTransport(respond))
    with pytest.raises(ObservationModelError, match="truncated"):
        await provider(
            config=ProviderConfig(base_url="https://provider.invalid/v1", api_key="k"),
            payload={"model": "m", "messages": []},
        )


@pytest.mark.anyio
async def test_malformed_model_json_is_rejected_without_echoing_content() -> None:
    private_content = "PRIVATE_MODEL_OUTPUT"

    class MalformedProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            return private_content

    request = ReadRequest(operation_id=uuid4(), model="vision-model", frame=_frame())
    with pytest.raises(ObservationModelError) as error:
        await BrowserModel(
            provider=MalformedProvider(), budgeter=lambda **_: None
        ).read(request=request)

    assert private_content not in str(error.value)


@pytest.mark.anyio
async def test_model_call_has_total_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.observation.model as model_module

    monkeypatch.setattr(model_module, "MODEL_TIMEOUT_SECONDS", 0.01)

    class SlowProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            await asyncio.sleep(1)
            return "{}"

    request = ReadRequest(operation_id=uuid4(), model="vision-model", frame=_frame())
    with pytest.raises(ObservationModelError, match="timed out"):
        await BrowserModel(provider=SlowProvider(), budgeter=lambda **_: None).read(
            request=request
        )
