import json
from typing import Any
from uuid import uuid4

import pytest

from app.observation.model import BrowserModel, ObservationModelError
from app.observation.schemas import CompactRequest


@pytest.mark.anyio
async def test_compaction_sends_strict_schema_and_budgets_it() -> None:
    request = CompactRequest(
        operation_id=uuid4(), model="selected-model", summary="A page.", notes=[]
    )
    budgeted_messages: list[list[dict[str, Any]]] = []
    seen: dict[str, Any] = {}

    def budgeter(**kwargs: Any) -> None:
        budgeted_messages.append(kwargs["messages"])

    class FakeProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            seen["payload"] = payload
            return json.dumps({"summary": "A concise page summary."})

    summary = await BrowserModel(provider=FakeProvider(), budgeter=budgeter).compact(
        request=request
    )

    assert summary == "A concise page summary."
    response_format = seen["payload"]["response_format"]
    schema = response_format["json_schema"]
    assert schema["strict"] is True
    assert schema["schema"]["additionalProperties"] is False
    assert schema["schema"]["required"] == ["summary"]
    assert schema["schema"]["properties"]["summary"]["minLength"] == 1
    assert schema["schema"]["properties"]["summary"]["pattern"] == r"\S"
    assert budgeted_messages[0][:-1] == seen["payload"]["messages"]
    assert json.loads(budgeted_messages[0][-1]["content"]) == response_format


@pytest.mark.anyio
@pytest.mark.parametrize("summary", ["", " \t\n"])
async def test_compaction_rejects_blank_summary(*, summary: str) -> None:
    request = CompactRequest(
        operation_id=uuid4(), model="selected-model", summary="A page.", notes=[]
    )

    class FakeProvider:
        async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
            return json.dumps({"summary": summary})

    with pytest.raises(ObservationModelError, match="invalid summary data"):
        await BrowserModel(provider=FakeProvider(), budgeter=lambda **_: None).compact(
            request=request
        )
