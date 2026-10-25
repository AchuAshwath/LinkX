"""Model-aware input accounting for single-frame observation turns."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

MAX_OBSERVATION_INPUT_TOKENS = 12_000


class ObservationInputBudgetError(ValueError):
    """Raised when model-specific observation input accounting is unavailable or over budget."""

    def __init__(
        self,
        message: str,
        *,
        reason: str = "budget_unavailable",
        budget: "ObservationInputBudget | None" = None,
    ) -> None:
        super().__init__(message)
        self.reason = reason
        self.budget = budget


@dataclass(frozen=True)
class ObservationInputBudget:
    model_id: str
    model_input_capacity: int
    output_reserve: int
    input_limit: int
    estimated_input_tokens: int


def _require_vision_model_capacity(*, metadata: Mapping[str, Any], reserve: int) -> int:
    capacity = metadata.get("max_input_tokens")
    if not _has_supported_capacities(metadata=metadata, reserve=reserve):
        raise ObservationInputBudgetError(
            "Observation model input metadata is missing or unsupported"
        )
    if type(capacity) is not int:
        raise ObservationInputBudgetError(
            "Observation model input metadata is missing or unsupported"
        )
    return capacity


def _has_supported_capacities(*, metadata: Mapping[str, Any], reserve: int) -> bool:
    capacity = metadata.get("max_input_tokens")
    if type(capacity) is not int or capacity <= reserve:
        return False
    maximum_output = metadata.get("max_output_tokens")
    if type(maximum_output) is not int or maximum_output < reserve:
        return False
    return metadata.get("supports_vision") is True


def _resolve_model_input_limit(
    *, model: str, output_reserve: int, input_cap: int | None
) -> tuple[str, int, int]:
    from litellm import get_model_info

    model_id = model.removeprefix("openai/")
    try:
        metadata = get_model_info(model_id)
    except Exception as exc:
        raise ObservationInputBudgetError(
            "Observation model input metadata is unavailable"
        ) from exc
    capacity = _require_vision_model_capacity(
        metadata=metadata,
        reserve=output_reserve,
    )
    return (
        model_id,
        capacity,
        min(input_cap, capacity - output_reserve)
        if input_cap is not None
        else capacity - output_reserve,
    )


def _estimate_input_tokens(*, model_id: str, messages: list[dict[str, Any]]) -> int:
    from litellm import token_counter

    try:
        estimated_tokens = token_counter(model=model_id, messages=messages)
    except Exception as exc:
        raise ObservationInputBudgetError(
            "Observation input token estimate is unavailable"
        ) from exc
    if type(estimated_tokens) is not int or estimated_tokens < 0:
        raise ObservationInputBudgetError("Observation input token estimate is invalid")
    return estimated_tokens


def budget_observation_messages(
    *,
    model: str,
    messages: list[dict[str, Any]],
    output_reserve: int,
    input_cap: int | None = MAX_OBSERVATION_INPUT_TOKENS,
) -> ObservationInputBudget:
    """Count text and image input with LiteLLM metadata, failing closed when unavailable."""
    model_id, capacity, input_limit = _resolve_model_input_limit(
        model=model,
        output_reserve=output_reserve,
        input_cap=input_cap,
    )
    estimated_tokens = _estimate_input_tokens(model_id=model_id, messages=messages)
    budget = ObservationInputBudget(
        model_id=model_id,
        model_input_capacity=capacity,
        output_reserve=output_reserve,
        input_limit=input_limit,
        estimated_input_tokens=estimated_tokens,
    )
    if estimated_tokens > input_limit:
        raise ObservationInputBudgetError(
            "Observation input exceeds the model input budget",
            reason="input_too_large",
            budget=budget,
        )

    return budget


def budget_browser_messages(
    *, model: str, messages: list[dict[str, Any]], output_reserve: int
) -> ObservationInputBudget:
    """Use the selected model's window for ephemeral reading, retaining legacy caps elsewhere."""
    return budget_observation_messages(
        model=model, messages=messages, output_reserve=output_reserve, input_cap=None
    )
