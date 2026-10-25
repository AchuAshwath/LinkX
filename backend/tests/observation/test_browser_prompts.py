"""Provider request contracts for browser reading and compaction."""

import base64
import io
import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import pytest
from PIL import Image

from app.observation.model import BrowserModel, ObservationModelError
from app.observation.schemas import (
    BrowserFrame,
    BrowserNote,
    CompactRequest,
    ReadRequest,
)


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
async def test_read_returns_bounded_note_with_identity_from_request() -> None:
    frame = _frame()
    request = ReadRequest(operation_id=uuid4(), model="vision-model", frame=frame)
    seen: dict[str, Any] = {}

    class FakeProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            seen["config"] = config
            seen["payload"] = payload
            return json.dumps(
                {
                    "text": "  A blue rectangle is visible.  ",
                    "uncertainty": "The rest is too small to read.",
                }
            )

    note = await BrowserModel(provider=FakeProvider(), budgeter=lambda **_: None).read(
        request=request
    )

    assert note == BrowserNote(
        id=frame.id,
        sequence=frame.sequence,
        model=request.model,
        text="  A blue rectangle is visible.  ",
        uncertainty="The rest is too small to read.",
    )
    response_format = seen["payload"]["response_format"]
    schema = response_format["json_schema"]
    assert schema["strict"] is True
    assert schema["schema"]["additionalProperties"] is False
    assert schema["schema"]["required"] == ["text", "uncertainty"]
    messages = seen["payload"]["messages"]
    assert messages[0]["role"] == "system"
    prompt = messages[0]["content"].lower()
    assert prompt.index("main page content") < prompt.index("navigation")
    assert "begin the text with main content" in prompt
    assert prompt.index("exact name and utterance") < prompt.index("repeated controls")
    assert prompt.index("page or channel orientation at the end") > prompt.index(
        "main page content"
    )
    assert "author" in prompt and "comments" in prompt
    assert "headings" in prompt and "tables" in prompt and "code" in prompt
    assert "form" in prompt and "values" in prompt
    assert "exact" in prompt and "uncertain" in prompt
    assert "offscreen" in prompt
    assert "do not inventory" in prompt
    assert "skip generic layout" in prompt
    assert "global navigation stays secondary" in prompt
    assert "preserve page-specific settings and form controls" in prompt
    assert "short factual statement" in prompt
    assert "charts" in prompt and "trends" in prompt
    assert "diagrams" in prompt and "meaningful imagery" in prompt
    assert "no meaningful content can be transcribed or described" in prompt
    user_content = messages[1]["content"]
    assert user_content[0]["type"] == "text"
    assert "extract main page content first" in user_content[0]["text"].lower()
    assert "describe useful page layout details" not in user_content[0]["text"].lower()
    assert "short note" not in user_content[0]["text"]
    assert frame.image_data_url == user_content[1]["image_url"]["url"]
    assert "max_tokens" in seen["payload"]


@pytest.mark.anyio
async def test_read_rejects_blank_provider_transcription() -> None:
    class BlankProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            return json.dumps({"text": " \n\t "})

    request = ReadRequest(operation_id=uuid4(), model="vision-model", frame=_frame())

    with pytest.raises(ObservationModelError, match="invalid note data"):
        await BrowserModel(provider=BlankProvider(), budgeter=lambda **_: None).read(
            request=request
        )


@pytest.mark.anyio
async def test_read_rejects_missing_uncertainty_field() -> None:
    class IncompleteProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            return json.dumps({"text": "A visible menu."})

    request = ReadRequest(operation_id=uuid4(), model="vision-model", frame=_frame())

    with pytest.raises(ObservationModelError, match="invalid note data"):
        await BrowserModel(
            provider=IncompleteProvider(), budgeter=lambda **_: None
        ).read(request=request)


@pytest.mark.anyio
async def test_compact_preserves_ordered_input_and_returns_bounded_summary() -> None:
    notes = [
        BrowserNote(id="frame-1", sequence=1, model="vision", text="Sign in page"),
        BrowserNote(id="frame-2", sequence=2, model="vision", text="Error banner"),
    ]
    request = CompactRequest(
        operation_id=uuid4(),
        model="selected-model",
        summary="",
        notes=notes,
    )
    seen: dict[str, Any] = {}

    class FakeProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            seen["payload"] = payload
            return json.dumps({"summary": "A sign-in page shows an error banner."})

    summary = await BrowserModel(
        provider=FakeProvider(), budgeter=lambda **_: None
    ).compact(request=request)

    assert summary == "A sign-in page shows an error banner."
    serialized = seen["payload"]["messages"][1]["content"]
    assert serialized.index("frame-1") < serialized.index("frame-2")
    assert seen["payload"]["model"] == "selected-model"


@pytest.mark.anyio
async def test_compact_prompt_preserves_content_and_distinguishes_chrome_from_changes() -> (
    None
):
    request = CompactRequest(
        operation_id=uuid4(),
        model="selected-model",
        summary="Feed shows a repeated Home navigation label.",
        notes=[
            BrowserNote(
                id="frame-1",
                sequence=1,
                model="vision",
                text="Monisha Rao: The launch is on Friday. Home navigation.",
            )
        ],
    )
    seen: dict[str, Any] = {}

    class FakeProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            seen["payload"] = payload
            return json.dumps({"summary": "Monisha Rao says the launch is Friday."})

    await BrowserModel(provider=FakeProvider(), budgeter=lambda **_: None).compact(
        request=request
    )

    prompt = seen["payload"]["messages"][0]["content"].lower()
    assert "deduplicate" in prompt and "repeated" in prompt
    assert "lead with body facts" in prompt
    assert prompt.index("speaker attribution") < prompt.index(
        "page orientation at the end"
    )
    assert "content" in prompt and "speaker" in prompt
    assert "meaningful" in prompt and "alerts" in prompt and "actions" in prompt
    assert "uncertainty" in prompt and "ordering" in prompt
    assert "silently drop" in prompt
    assert "skip decorative layout" in prompt
    assert "global chrome" in prompt
