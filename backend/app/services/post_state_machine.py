from __future__ import annotations


ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"scheduled", "publishing"},
    "scheduled": {"publishing", "failed"},
    "publishing": {"published", "failed"},
    "published": set(),
    "failed": {"scheduled"},
}


def validate_transition(
    *,
    current_status: str,
    target_status: str,
    manual_retry: bool = False,
) -> None:
    if current_status == target_status:
        return

    allowed_targets = ALLOWED_TRANSITIONS.get(current_status)
    if allowed_targets is None:
        raise ValueError(f"Unknown current status: {current_status}")

    if target_status not in allowed_targets:
        raise ValueError(f"Invalid transition: {current_status} -> {target_status}")

    if current_status == "failed" and target_status == "scheduled" and not manual_retry:
        raise ValueError("failed -> scheduled is only allowed via manual retry")
