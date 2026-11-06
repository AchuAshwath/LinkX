"""Count the actual selected-model agent input, including tool definitions."""

from dataclasses import dataclass
from typing import Any

from app.services.ai_observation_budget import (
    ObservationInputBudget,
    ObservationInputBudgetError,
)


@dataclass(frozen=True)
class AgentBudgetInput:
    model: str
    messages: list[dict[str, Any]]
    tools: list[dict[str, Any]]
    output_reserve: int = 1500


def budget_agent_input(*, request: AgentBudgetInput) -> ObservationInputBudget:
    """Fail closed on unknown capacity, counting prompt, evidence and tools together."""
    model = request.model.removeprefix("openai/")
    capacity, estimate = _count_input(request=request, model=model)
    margin = max(512, capacity // 20)
    budget = ObservationInputBudget(
        model_id=model,
        model_input_capacity=capacity,
        output_reserve=request.output_reserve,
        input_limit=capacity - request.output_reserve - margin,
        estimated_input_tokens=estimate,
    )
    if estimate > budget.input_limit:
        raise ObservationInputBudgetError(
            "The combined agent input exceeds this model's allowance",
            reason="input_too_large",
            budget=budget,
        )
    return budget


def _count_input(*, request: AgentBudgetInput, model: str) -> tuple[int, int]:
    from litellm import get_model_info, token_counter

    try:
        metadata = get_model_info(model)
        capacity = _require_capacity(
            capacity=metadata.get("max_input_tokens"),
            maximum_output=metadata.get("max_output_tokens"),
            reserve=request.output_reserve,
        )
        estimate = token_counter(
            model=model, messages=request.messages, tools=request.tools
        )
    except ObservationInputBudgetError:
        raise
    except Exception:
        raise ObservationInputBudgetError(
            "Agent input accounting is unavailable"
        ) from None
    if type(estimate) is not int or estimate < 0:
        raise ObservationInputBudgetError("Agent input token estimate is invalid")
    return capacity, estimate


def _require_capacity(*, capacity: Any, maximum_output: Any, reserve: int) -> int:
    if type(capacity) is not int or capacity <= reserve + 512:
        raise ObservationInputBudgetError("Agent model input metadata is unavailable")
    if type(maximum_output) is not int or maximum_output < reserve:
        raise ObservationInputBudgetError("Agent model output metadata is unavailable")
    return capacity
