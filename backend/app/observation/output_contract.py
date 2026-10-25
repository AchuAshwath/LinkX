"""Shared strict JSON output contracts for observation model requests."""

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from app.services.ai_observation_budget import ObservationInputBudget


@dataclass(frozen=True)
class StructuredRequest:
    model: str
    messages: list[dict[str, Any]]
    schema_name: str
    output_model: type[BaseModel]
    output_reserve: int


def _strict_schema(*, output_model: type[BaseModel]) -> dict[str, Any]:
    schema = output_model.model_json_schema()
    schema.pop("title", None)
    _normalize_schema_node(node=schema)
    return schema


def _normalize_schema_node(*, node: Any) -> None:
    if isinstance(node, list):
        for item in node:
            _normalize_schema_node(node=item)
        return
    if not isinstance(node, dict):
        return
    node.pop("title", None)
    node.pop("default", None)
    _enforce_strict_object_schema(node=node)
    for value in node.values():
        _normalize_schema_node(node=value)


def _enforce_strict_object_schema(*, node: dict[str, Any]) -> None:
    properties = node.get("properties")
    is_object_schema = node.get("type") == "object" or isinstance(properties, dict)
    if not is_object_schema:
        return
    node["additionalProperties"] = False
    if isinstance(properties, dict):
        node["required"] = list(properties)


def build_structured_payload(
    *, request: StructuredRequest, budgeter: Callable[..., Any]
) -> tuple[dict[str, Any], ObservationInputBudget | None]:
    response_format = {
        "type": "json_schema",
        "json_schema": {
            "name": request.schema_name,
            "strict": True,
            "schema": _strict_schema(output_model=request.output_model),
        },
    }
    schema_message = {
        "role": "system",
        "content": json.dumps(
            response_format, ensure_ascii=False, separators=(",", ":")
        ),
    }
    budget = budgeter(
        model=request.model,
        messages=[*request.messages, schema_message],
        output_reserve=request.output_reserve,
    )
    payload = {
        "model": request.model.removeprefix("openai/"),
        "messages": request.messages,
        "max_tokens": request.output_reserve,
        "stream": False,
        "response_format": response_format,
    }
    return payload, budget if isinstance(budget, ObservationInputBudget) else None
