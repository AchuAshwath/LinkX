"""LangGraph StateGraph supervisor for diagnosing and healing broken browser selectors."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.services.agentic.client import get_chat_model
from app.services.agentic.schemas import SelectorDiagnosisReport
from app.services.browser.tools import (
    _set_nested_selector,
    get_dom_snippet,
    patch_selector_config,
    validate_selector_candidate,
)

logger = logging.getLogger(__name__)

DIAGNOSTIC_SYSTEM_PROMPT = """You are an expert web automation diagnostics engineer.
A browser selector failed on X.com (Twitter).
Analyze the provided sanitized DOM snippet and determine the best candidate CSS or XPath selectors to target the intended element.
Return a valid SelectorDiagnosisReport."""


class SelfHealingState(TypedDict, total=False):
    page: Any
    failed_selector_key: str
    target_config_path: str
    dom_snippet: str | None
    diagnosis: SelectorDiagnosisReport | None
    working_selector: str | None
    status: str
    error: str | None


async def capture_dom_node(state: SelfHealingState) -> dict[str, Any]:
    """Capture a sanitized DOM snippet from the live page."""
    page = state["page"]
    dom = await get_dom_snippet(page=page, max_chars=6000)
    return {"dom_snippet": dom, "status": "dom_captured"}


async def diagnose_dom_node(state: SelfHealingState) -> dict[str, Any]:
    """Use structured chat model to diagnose failure and propose candidate selectors."""
    dom = state.get("dom_snippet") or ""
    failed_key = state.get("failed_selector_key") or "unknown_element"

    try:
        model = get_chat_model(temperature=0.1)
        structured_model = model.with_structured_output(
            SelectorDiagnosisReport, method="json_mode"
        )

        prompt = (
            f"Failed Element Name: {failed_key}\n"
            f"Current Page DOM:\n{dom}\n\n"
            f"Identify candidate selectors matching the '{failed_key}' element. Return a JSON object with 'candidate_selectors' list."
        )

        diagnosis = await structured_model.ainvoke(
            [
                {"role": "system", "content": DIAGNOSTIC_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ]
        )

        if not isinstance(diagnosis, SelectorDiagnosisReport):
            return {
                "diagnosis": None,
                "status": "diagnosis_failed",
                "error": "Model returned invalid report type",
            }

        return {"diagnosis": diagnosis, "status": "diagnosed"}
    except Exception as e:
        logger.error(f"LLM selector diagnosis error for '{failed_key}': {e}")
        return {"diagnosis": None, "status": "diagnosis_failed", "error": str(e)}


async def verify_candidates_node(state: SelfHealingState) -> dict[str, Any]:
    """Test proposed candidate selectors on the live Playwright page."""
    diagnosis = state.get("diagnosis")
    page = state["page"]

    if not diagnosis or not diagnosis.candidate_selectors:
        return {"working_selector": None, "status": "no_candidates"}

    sorted_candidates = sorted(
        diagnosis.candidate_selectors, key=lambda c: c.confidence, reverse=True
    )

    for candidate in sorted_candidates:
        test_result = await validate_selector_candidate(
            page=page, selector=candidate.selector
        )
        if test_result["found"] and test_result["visible"]:
            logger.info(
                f"Candidate selector '{candidate.selector}' verified on page with count={test_result['count']}"
            )
            return {
                "working_selector": candidate.selector,
                "status": "candidate_verified",
            }

    return {"working_selector": None, "status": "all_candidates_failed"}


async def apply_patch_node(state: SelfHealingState) -> dict[str, Any]:
    """Persist the verified selector to the target configuration file."""
    working_selector = state.get("working_selector")
    config_path = state.get("target_config_path")
    failed_key = state.get("failed_selector_key")

    if working_selector and config_path and failed_key:
        patched = patch_selector_config(
            config_path=config_path,
            key_path=failed_key,
            new_selector=working_selector,
        )
        return {"status": "healed" if patched else "patch_failed"}

    return {"status": "failed"}


def _route_after_diagnosis(state: SelfHealingState) -> str:
    diagnosis = state.get("diagnosis")
    if diagnosis and state.get("status") == "diagnosed":
        if (
            diagnosis.page_state
            in {"logged_out", "rate_limited", "challenge", "captcha", "suspended"}
            or not diagnosis.is_recoverable
        ):
            logger.warning(
                f"Aborting self-healing: page state is '{diagnosis.page_state}', is_recoverable={diagnosis.is_recoverable}"
            )
            return END
        return "verify_candidates"
    return END


def _route_after_verification(state: SelfHealingState) -> str:
    if state.get("working_selector"):
        return "apply_patch"
    return END


def build_self_healing_graph() -> Any:
    """Compile the LangGraph StateGraph for selector diagnosis and healing."""
    builder = StateGraph(SelfHealingState)

    builder.add_node("capture_dom", capture_dom_node)
    builder.add_node("diagnose_dom", diagnose_dom_node)
    builder.add_node("verify_candidates", verify_candidates_node)
    builder.add_node("apply_patch", apply_patch_node)

    builder.add_edge(START, "capture_dom")
    builder.add_edge("capture_dom", "diagnose_dom")
    builder.add_conditional_edges("diagnose_dom", _route_after_diagnosis)
    builder.add_conditional_edges("verify_candidates", _route_after_verification)
    builder.add_edge("apply_patch", END)

    return builder.compile()


_self_healing_graph = build_self_healing_graph()


async def heal_selector(
    *,
    page: Any,
    failed_selector_key: str,
    config_path: str | Path,
    selectors_dict: dict[str, Any] | None = None,
) -> str | None:
    """Run the self-healing supervisor to diagnose, verify, and patch a broken selector."""
    initial_state: SelfHealingState = {
        "page": page,
        "failed_selector_key": failed_selector_key,
        "target_config_path": str(config_path),
        "dom_snippet": None,
        "diagnosis": None,
        "working_selector": None,
        "status": "pending",
        "error": None,
    }

    try:
        final_state = await _self_healing_graph.ainvoke(initial_state)
        working_selector = final_state.get("working_selector")

        if working_selector and selectors_dict is not None:
            _set_nested_selector(selectors_dict, failed_selector_key, working_selector)

        return str(working_selector) if working_selector else None
    except Exception as e:
        logger.error(f"Error during self-healing workflow: {e}")
        return None
