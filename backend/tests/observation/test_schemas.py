import base64
import io
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from PIL import Image
from pydantic import ValidationError

from app.observation.schemas import BrowserContext, BrowserFrame, BrowserNote


def frame(sequence=1):
    data = io.BytesIO()
    Image.new("RGB", (2, 2)).save(data, format="JPEG")
    return BrowserFrame(
        id=f"f{sequence}",
        sequence=sequence,
        captured_at=datetime.now(timezone.utc),
        width=2,
        height=2,
        image_data_url="data:image/jpeg;base64,"
        + base64.b64encode(data.getvalue()).decode(),
    )


def test_frozen_batch_rejects_future_or_duplicate_content():
    payload = {
        "session_id": uuid4(),
        "generation": 1,
        "cutoff": 1,
        "pending_frames": [frame()],
    }
    with pytest.raises(ValidationError, match="cutoff"):
        BrowserContext(**{**payload, "cutoff": 0})
    with pytest.raises(ValidationError, match="duplicate"):
        BrowserContext(**{**payload, "pending_frames": [frame(), frame()]})
    with pytest.raises(ValidationError, match="already"):
        BrowserContext(
            **payload, notes=[BrowserNote(id="f1", sequence=1, text="x", model="x")]
        )


def test_image_metadata_and_utf8_memory_are_validated():
    payload = frame().model_dump()
    with pytest.raises(ValidationError, match="dimensions"):
        BrowserFrame(**{**payload, "width": 3})
    notes = [
        BrowserNote(id=str(n), sequence=n + 1, text="界" * 4000, model="x")
        for n in range(3)
    ]
    with pytest.raises(ValidationError, match="byte limit"):
        BrowserContext(session_id=uuid4(), generation=1, cutoff=3, notes=notes)


def test_browser_chat_rejects_ungated_current_view_before_dispatch():
    from app.observation.schemas import BrowserChatRequest

    context = BrowserContext(
        session_id=uuid4(), generation=1, cutoff=1, current_view=frame()
    )
    with pytest.raises(ValidationError, match="not enabled"):
        BrowserChatRequest(
            message="What is this?",
            model="vision",
            request_id=uuid4(),
            browser_context=context,
        )
