"""LangGraph StateGraph supervisor for iterative draft refinement and constraint compliance."""

from __future__ import annotations

import logging
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.services.agentic.schemas import RefinedDraftReport
from app.services.agentic.tools.curation_tools import (
    refine_post_draft,
    validate_post_constraints,
)

logger = logging.getLogger(__name__)


class DraftRefinementState(TypedDict, total=False):
    content: str
    platform: str
    is_premium: bool
    violated_constraints: list[str]
    target_tone: str | None
    max_attempts: int
    attempt: int
    refined_content: str | None
    is_compliant: bool
    compliance_report: dict[str, Any]
    status: str
    error: str | None


async def validate_current_draft_node(
    state: DraftRefinementState,
) -> dict[str, Any]:
    """Validate initial post draft constraints deterministically."""
    try:
        content = state.get("refined_content") or state.get("content", "")
        platform = state.get("platform", "x")
        is_premium = state.get("is_premium", False)
        external_violations = list(state.get("violated_constraints") or [])

        report = validate_post_constraints(
            content=content,
            platform=platform,
            is_premium=is_premium,
        )

        all_violations = list(report.violations)
        for v in external_violations:
            if v not in all_violations:
                all_violations.append(v)

        is_compliant = len(all_violations) == 0
        compliance_dict = report.model_dump()
        compliance_dict["violations"] = all_violations
        compliance_dict["is_compliant"] = is_compliant

        return {
            "refined_content": content,
            "is_compliant": is_compliant,
            "violated_constraints": all_violations,
            "compliance_report": compliance_dict,
            "status": "compliant" if is_compliant else "non_compliant",
        }
    except Exception as e:
        logger.error(f"Error in validate_current_draft_node: {e}")
        fallback_content = state.get("content", "")
        return {
            "refined_content": fallback_content,
            "is_compliant": False,
            "status": "error",
            "error": str(e),
        }


async def refine_draft_with_feedback_node(
    state: DraftRefinementState,
) -> dict[str, Any]:
    """Refine post draft using LLM with structured violation feedback and target tone."""
    current_attempt = state.get("attempt", 0) + 1
    fallback_content = state.get("refined_content") or state.get("content", "")
    platform = state.get("platform", "x")
    violations = state.get("violated_constraints", [])
    compliance_report = state.get("compliance_report", {})
    suggestions = compliance_report.get("suggestions", [])
    target_tone = state.get("target_tone")

    instruction_parts: list[str] = []
    if violations:
        instruction_parts.append("Fix the following constraint violations:")
        for v in violations:
            instruction_parts.append(f"- {v}")
    if suggestions:
        instruction_parts.append("Follow these suggestions:")
        for s in suggestions:
            instruction_parts.append(f"- {s}")
    if target_tone:
        instruction_parts.append(f"Ensure the post adopts a '{target_tone}' tone.")

    instructions = (
        "\n".join(instruction_parts)
        if instruction_parts
        else "Refine and polish this post draft."
    )

    try:
        new_content = await refine_post_draft(
            content=fallback_content,
            platform=platform,
            instructions=instructions,
        )

        # Invariant: refined_content is NEVER empty/None
        if not new_content or not new_content.strip():
            new_content = fallback_content

        return {
            "attempt": current_attempt,
            "refined_content": new_content,
            "status": "refined",
        }
    except Exception as e:
        logger.error(f"Error in refine_draft_with_feedback_node: {e}")
        return {
            "attempt": current_attempt,
            "refined_content": fallback_content,
            "status": "error",
            "error": str(e),
        }


async def revalidate_refined_draft_node(
    state: DraftRefinementState,
) -> dict[str, Any]:
    """Re-check constraints on the newly refined post draft."""
    if state.get("status") == "error":
        return {
            "is_compliant": False,
            "status": "error",
        }

    try:
        content = state.get("refined_content") or state.get("content", "")
        platform = state.get("platform", "x")
        is_premium = state.get("is_premium", False)

        report = validate_post_constraints(
            content=content,
            platform=platform,
            is_premium=is_premium,
        )
        compliance_dict = report.model_dump()

        return {
            "is_compliant": report.is_compliant,
            "violated_constraints": list(report.violations),
            "compliance_report": compliance_dict,
            "status": "compliant" if report.is_compliant else "non_compliant",
        }
    except Exception as e:
        logger.error(f"Error in revalidate_refined_draft_node: {e}")
        return {
            "is_compliant": False,
            "status": "error",
            "error": str(e),
        }


def _route_after_validation(state: DraftRefinementState) -> str:
    """Route after validation or revalidation check."""
    if state.get("status") == "error":
        return END

    if state.get("is_compliant", False):
        return END

    attempt = state.get("attempt", 0)
    max_attempts = state.get("max_attempts", 2)

    if attempt < max_attempts:
        return "refine_draft"

    return END


def _route_after_refinement(state: DraftRefinementState) -> str:
    """Route after refinement node."""
    if state.get("status") == "error":
        return END
    return "revalidate_draft"


def build_draft_refinement_graph() -> Any:
    """Compile the LangGraph StateGraph for draft refinement."""
    builder = StateGraph(DraftRefinementState)

    builder.add_node("validate_current_draft", validate_current_draft_node)
    builder.add_node("refine_draft", refine_draft_with_feedback_node)
    builder.add_node("revalidate_draft", revalidate_refined_draft_node)

    builder.add_edge(START, "validate_current_draft")
    builder.add_conditional_edges("validate_current_draft", _route_after_validation)
    builder.add_conditional_edges("refine_draft", _route_after_refinement)
    builder.add_conditional_edges("revalidate_draft", _route_after_validation)

    return builder.compile()


_draft_refinement_graph = build_draft_refinement_graph()


async def refine_draft_with_graph(
    *,
    content: str,
    platform: str = "x",
    violated_constraints: list[str] | None = None,
    target_tone: str | None = None,
    is_premium: bool = False,
    max_attempts: int = 2,
) -> RefinedDraftReport:
    """Run iterative draft refinement supervisor to produce a compliant post draft."""
    initial_state: DraftRefinementState = {
        "content": content,
        "platform": platform,
        "is_premium": is_premium,
        "violated_constraints": (
            list(violated_constraints) if violated_constraints else []
        ),
        "target_tone": target_tone,
        "max_attempts": max_attempts,
        "attempt": 0,
        "refined_content": None,
        "is_compliant": False,
        "compliance_report": {},
        "status": "pending",
        "error": None,
    }

    try:
        final_state = await _draft_refinement_graph.ainvoke(initial_state)

        refined_content = final_state.get("refined_content") or content
        is_compliant = bool(final_state.get("is_compliant", False))
        attempt_count = int(final_state.get("attempt", 0))
        error = final_state.get("error")

        if error or final_state.get("status") == "error":
            status = "error"
        elif is_compliant:
            status = "compliant"
        else:
            status = "best_effort"

        violations = list(final_state.get("violated_constraints") or [])
        compliance_report = final_state.get("compliance_report")

        return RefinedDraftReport(
            refined_content=refined_content,
            is_compliant=is_compliant,
            platform=platform,
            attempts=attempt_count,
            status=status,
            violated_constraints=violations,
            compliance_report=compliance_report,
            error=error,
        )
    except Exception as e:
        logger.error(f"Error during draft refinement graph execution: {e}")
        return RefinedDraftReport(
            refined_content=content,
            is_compliant=False,
            platform=platform,
            attempts=0,
            status="error",
            violated_constraints=(
                list(violated_constraints) if violated_constraints else []
            ),
            compliance_report=None,
            error=str(e),
        )
