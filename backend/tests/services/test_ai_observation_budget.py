from typing import Any
from unittest.mock import patch

import pytest

from app.services import ai_chat_runner
from app.services.ai_observation_budget import (
    ObservationInputBudgetError,
    budget_observation_messages,
)


def _messages() -> list[dict[str, Any]]:
    return [
        {"role": "system", "content": "Observe only this screenshot."},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "What is visible?"},
                {
                    "type": "image_url",
                    "image_url": {"url": "data:image/jpeg;base64,abc"},
                },
            ],
        },
    ]


def test_budget_uses_model_metadata_and_counts_complete_request() -> None:
    with (
        patch(
            "litellm.get_model_info",
            return_value={
                "max_input_tokens": 10_000,
                "max_output_tokens": 2_000,
                "supports_vision": True,
            },
        ),
        patch("litellm.token_counter", return_value=120) as count_tokens,
    ):
        budget = budget_observation_messages(
            model="openai/gpt-5.6-luna",
            messages=_messages(),
            output_reserve=1200,
        )

    assert budget.model_id == "gpt-5.6-luna"
    assert budget.input_limit == 8_800
    assert budget.estimated_input_tokens == 120
    count_tokens.assert_called_once_with(model="gpt-5.6-luna", messages=_messages())


def test_budget_applies_application_cap_below_large_provider_context() -> None:
    with (
        patch(
            "litellm.get_model_info",
            return_value={
                "max_input_tokens": 922_000,
                "max_output_tokens": 128_000,
                "supports_vision": True,
            },
        ),
        patch("litellm.token_counter", return_value=800),
    ):
        budget = budget_observation_messages(
            model="gpt-5.6-luna",
            messages=_messages(),
            output_reserve=1200,
        )

    assert budget.input_limit == 12_000


def test_budget_rejects_overflow_without_pruning_required_content() -> None:
    messages = _messages()
    with (
        patch(
            "litellm.get_model_info",
            return_value={
                "max_input_tokens": 2_000,
                "max_output_tokens": 2_000,
                "supports_vision": True,
            },
        ),
        patch("litellm.token_counter", return_value=801),
    ):
        with pytest.raises(ObservationInputBudgetError, match="input budget"):
            budget_observation_messages(
                model="gpt-5.6-luna", messages=messages, output_reserve=1200
            )

    assert messages == _messages()
    assert messages[1]["content"][0]["text"]
    assert messages[1]["content"][1]["image_url"]["url"]


@pytest.mark.parametrize(
    "metadata",
    [
        {
            "max_input_tokens": 10_000,
            "max_output_tokens": 2_000,
            "supports_vision": False,
        },
        {
            "max_input_tokens": None,
            "max_output_tokens": 2_000,
            "supports_vision": True,
        },
        {
            "max_input_tokens": 10_000,
            "max_output_tokens": 1_199,
            "supports_vision": True,
        },
        {},
    ],
)
def test_budget_fails_closed_without_model_capability_metadata(
    metadata: dict[str, Any],
) -> None:
    with (
        patch("litellm.get_model_info", return_value=metadata),
        patch("litellm.token_counter") as count_tokens,
    ):
        with pytest.raises(ObservationInputBudgetError, match="metadata"):
            budget_observation_messages(
                model="custom/unlisted-vision",
                messages=_messages(),
                output_reserve=1200,
            )

    count_tokens.assert_not_called()


def test_budget_counter_replays_same_model_input_estimate() -> None:
    messages = _messages()
    metadata = {
        "max_input_tokens": 10_000,
        "max_output_tokens": 2_000,
        "supports_vision": True,
    }
    with (
        patch("litellm.get_model_info", return_value=metadata),
        patch("litellm.token_counter", side_effect=[120, 120]) as count_tokens,
    ):
        first = budget_observation_messages(
            model="gpt-5.6-luna", messages=messages, output_reserve=1200
        )
        replay = budget_observation_messages(
            model="openai/gpt-5.6-luna", messages=messages, output_reserve=1200
        )

    assert first == replay
    assert count_tokens.call_count == 2


@pytest.mark.anyio
async def test_runner_does_not_call_provider_when_budget_check_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def unexpected_provider_call(**_kwargs: Any):
        raise AssertionError("provider must not run for an over-budget request")
        yield "unreachable"

    def reject_budget(**_kwargs: Any) -> None:
        raise ObservationInputBudgetError(
            "Observation input exceeds the model input budget"
        )

    monkeypatch.setattr(ai_chat_runner, "budget_observation_messages", reject_budget)
    monkeypatch.setattr(
        ai_chat_runner, "stream_direct_openai_proxy", unexpected_provider_call
    )

    events = [
        event
        async for event in ai_chat_runner.observation_chat_stream_runner(
            message="Keep this question",
            observation=type(
                "Packet", (), {"image_data_url": "data:image/jpeg;base64,x"}
            )(),
        )
    ]

    assert events == [
        (
            "error",
            {
                "message": (
                    "This question and selected content exceed the model input budget. "
                    "Please shorten your question or reduce the selected content, then try again."
                )
            },
        ),
        ("done", {}),
    ]
