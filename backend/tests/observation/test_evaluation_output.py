"""Strict provider output and safe validation diagnostics for evaluation."""

import json
from typing import Any
from uuid import uuid4

import httpx
import pytest

from app.observation.model import (
    BrowserModel,
    DirectOpenAIProvider,
    ObservationModelError,
)
from app.observation.schemas import EvaluationInput
from app.services.ai_observation_budget import ObservationInputBudgetError

EVALUATION_FIELDS = (
    "decision",
    "answer",
    "evidence_ids",
    "requires_complete",
    "answer_basis",
)
PRIVATE_VALUE = "PRIVATE_EVALUATION_OUTPUT"
DIAGNOSTIC_CASES = [
    *((field_name, "missing") for field_name in EVALUATION_FIELDS),
    ("answer_basis", "literal_error"),
]


def _request() -> EvaluationInput:
    return EvaluationInput(
        message="What is a tuple?",
        model="selected-model",
        context={"session_id": uuid4(), "generation": 1, "cutoff": 0},
    )


def _valid_output() -> dict[str, Any]:
    return {
        "decision": "answer",
        "answer": "An immutable sequence.",
        "evidence_ids": [],
        "requires_complete": False,
        "answer_basis": "general",
    }


class _EvaluationProvider:
    def __init__(self, *, content: str) -> None:
        self.content = content
        self.payloads: list[dict[str, Any]] = []

    async def __call__(self, *, config: Any, payload: dict[str, Any]) -> str:
        self.payloads.append(payload)
        return self.content


@pytest.mark.anyio
async def test_evaluator_uses_strict_schema_matching_local_validation() -> None:
    provider = _EvaluationProvider(content=json.dumps(_valid_output()))

    result = await BrowserModel(provider=provider, budgeter=lambda **_: None).evaluate(
        request=_request()
    )

    schema = provider.payloads[0]["response_format"]["json_schema"]
    properties = schema["schema"]["properties"]
    assert result.answer_basis == "general"
    assert schema["strict"] is True
    assert schema["schema"]["additionalProperties"] is False
    assert set(schema["schema"]["required"]) == set(EVALUATION_FIELDS)
    assert all("default" not in value for value in properties.values())
    assert properties["answer"]["maxLength"] == 25_000
    assert properties["evidence_ids"]["maxItems"] == 200


@pytest.mark.anyio
async def test_evaluator_budgets_schema_without_adding_it_to_chat_messages() -> None:
    budget_messages: list[list[dict[str, Any]]] = []
    provider = _EvaluationProvider(content=json.dumps(_valid_output()))
    request = _request()

    def budgeter(**kwargs: Any) -> None:
        budget_messages.append(kwargs["messages"])

    model = BrowserModel(provider=provider, budgeter=budgeter)
    model.preflight(request=request)
    await model.evaluate(request=request)

    assert len(budget_messages) == 2
    assert budget_messages[0] == budget_messages[1]
    payload = provider.payloads[0]
    schema_message = budget_messages[0][-1]
    assert schema_message["role"] == "system"
    assert json.loads(schema_message["content"]) == payload["response_format"]
    assert schema_message not in payload["messages"]
    assert len(payload["messages"]) == 2


@pytest.mark.anyio
async def test_schema_budget_overflow_rejects_before_provider_call() -> None:
    def budgeter(**kwargs: Any) -> None:
        assert len(kwargs["messages"]) == 3
        raise ObservationInputBudgetError(
            "Observation model input exceeds the model input budget",
            reason="input_too_large",
        )

    provider = _EvaluationProvider(content=json.dumps(_valid_output()))
    with pytest.raises(ObservationInputBudgetError):
        await BrowserModel(provider=provider, budgeter=budgeter).evaluate(
            request=_request()
        )

    assert provider.payloads == []


@pytest.mark.anyio
async def test_direct_provider_sends_strict_evaluation_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.config import settings

    monkeypatch.setattr(
        settings, "OPENAI_API_COMPATIBLE_API_KEY", "test-observation-key"
    )
    payloads: list[dict[str, Any]] = []

    def respond(http_request: httpx.Request) -> httpx.Response:
        payloads.append(json.loads(http_request.content))
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(_valid_output())}}]},
        )

    provider = DirectOpenAIProvider(transport=httpx.MockTransport(respond))
    result = await BrowserModel(provider=provider, budgeter=lambda **_: None).evaluate(
        request=_request()
    )

    assert result.answer_basis == "general"
    assert payloads[0]["response_format"]["json_schema"]["strict"] is True


@pytest.mark.anyio
@pytest.mark.parametrize(("invalid_field", "error_code"), DIAGNOSTIC_CASES)
async def test_evaluation_logs_safe_validation_diagnostics(
    *, invalid_field: str, error_code: str, caplog: pytest.LogCaptureFixture
) -> None:
    output = _valid_output()
    if error_code == "missing":
        output.pop(invalid_field)
        private_field = "answer" if invalid_field != "answer" else "evidence_ids"
        output[private_field] = (
            PRIVATE_VALUE if private_field == "answer" else [PRIVATE_VALUE]
        )
    else:
        output[invalid_field] = PRIVATE_VALUE
        output["answer"] = PRIVATE_VALUE
    provider = _EvaluationProvider(content=json.dumps(output))

    with pytest.raises(ObservationModelError, match="invalid evaluation data"):
        await BrowserModel(provider=provider, budgeter=lambda **_: None).evaluate(
            request=_request()
        )

    assert caplog.text.count("Browser evaluation schema validation failed:") == 1
    assert f"fields={invalid_field}" in caplog.text
    assert f"codes={error_code}" in caplog.text
    assert PRIVATE_VALUE not in caplog.text


@pytest.mark.anyio
async def test_evaluator_rejects_code_fenced_legacy_output() -> None:
    output = json.dumps(_valid_output())
    provider = _EvaluationProvider(content=f"```json\n{output}\n```")

    with pytest.raises(ObservationModelError, match="invalid JSON") as error:
        await BrowserModel(provider=provider, budgeter=lambda **_: None).evaluate(
            request=_request()
        )

    assert "```json" not in str(error.value)
