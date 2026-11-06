from typing import Any

import pytest

from app.services.ai_agent_budget import AgentBudgetInput, budget_agent_input
from app.services.ai_observation_budget import ObservationInputBudgetError


def test_agent_budget_rejects_tool_definitions_that_overflow_the_selected_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "litellm.get_model_info",
        lambda _: {"max_input_tokens": 5000, "max_output_tokens": 2000},
    )

    def count(*, model: str, messages: Any, tools: Any = None) -> int:
        assert model == "selected-model"
        assert messages[0]["content"] == "Protected question and browser evidence"
        return 3600 if tools else 100

    monkeypatch.setattr("litellm.token_counter", count)
    with pytest.raises(ObservationInputBudgetError) as raised:
        budget_agent_input(
            request=AgentBudgetInput(
                model="openai/selected-model",
                messages=[
                    {
                        "role": "user",
                        "content": "Protected question and browser evidence",
                    }
                ],
                tools=[{"type": "function", "function": {"name": "ordinary_tool"}}],
            )
        )
    assert raised.value.reason == "input_too_large"
