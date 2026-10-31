from typing import Any

import pytest

from app.observation.history import fit_browser_history, project_browser_history


def test_projects_only_text_and_marks_user_attachments_without_urls() -> None:
    history = [
        {
            "id": "user-id",
            "role": "user",
            "parent_id": "parent",
            "created_at": "today",
            "parts": [
                {"type": "text", "text": "Question"},
                {"type": "image_url", "url": "data:image/png;base64,secret"},
                {"type": "tool-call", "input": {"secret": "value"}},
            ],
        },
        {
            "id": "assistant-id",
            "role": "assistant",
            "parts": [{"type": "text", "text": "Answer"}],
        },
    ]

    groups = project_browser_history(history=history)

    assert groups == [
        [
            {
                "role": "user",
                "content": "Question\n[Earlier attachment omitted from browser context.]",
            },
            {"role": "assistant", "content": "Answer"},
        ]
    ]
    assert "secret" not in repr(groups)


def test_projection_groups_user_turns_and_keeps_legacy_string_content() -> None:
    history = [
        {"role": "assistant", "content": "Leading assistant"},
        {"role": "user", "content": "First"},
        {"role": "assistant", "parts": [{"type": "text", "text": "Reply"}]},
        {"role": "user", "parts": [{"type": "text", "text": "Second"}]},
    ]

    assert project_browser_history(history=history) == [
        [{"role": "assistant", "content": "Leading assistant"}],
        [
            {"role": "user", "content": "First"},
            {"role": "assistant", "content": "Reply"},
        ],
        [{"role": "user", "content": "Second"}],
    ]


def test_skips_empty_tool_only_assistant_messages() -> None:
    history = [
        {"role": "user", "content": "Question"},
        {"role": "assistant", "parts": [{"type": "tool-call", "input": {}}]},
    ]

    assert project_browser_history(history=history) == [
        [{"role": "user", "content": "Question"}]
    ]


def test_fit_returns_full_history_after_one_successful_build() -> None:
    groups = [[{"role": "user", "content": "A"}]]
    calls: list[list[dict[str, Any]]] = []

    def build(history: list[dict[str, Any]]) -> str:
        calls.append(history)
        return "payload"

    result = fit_browser_history(
        groups=groups,
        build=build,
        is_overflow=lambda error: False,
    )

    assert result == "payload"
    assert calls == [[{"role": "user", "content": "A"}]]


def test_fit_drops_oldest_whole_turns_until_latest_suffix_fits() -> None:
    groups = [
        [
            {"role": "user", "content": "old"},
            {"role": "assistant", "content": "old reply"},
        ],
        [
            {"role": "user", "content": "middle"},
            {"role": "assistant", "content": "middle reply"},
        ],
        [{"role": "user", "content": "latest"}],
    ]
    accepted: list[list[dict[str, Any]]] = []

    def build(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if len(history) > 2:
            raise ValueError("overflow")
        accepted.append(history)
        return history

    result = fit_browser_history(
        groups=groups,
        build=build,
        is_overflow=lambda error: str(error) == "overflow",
    )

    assert result == groups[2]
    assert result in accepted


def test_fit_propagates_overflow_when_protected_payload_does_not_fit() -> None:
    error = ValueError("overflow")
    attempts: list[list[dict[str, Any]]] = []

    def build(history: list[dict[str, Any]]) -> None:
        attempts.append(history)
        raise error

    with pytest.raises(ValueError, match="overflow") as raised:
        fit_browser_history(
            groups=[[{"role": "user", "content": "Old"}]],
            build=build,
            is_overflow=lambda failure: failure is error,
        )

    assert raised.value is error
    assert attempts == [
        [{"role": "user", "content": "Old"}],
        [],
    ]


def test_fit_does_not_retry_unknown_budget_errors() -> None:
    error = RuntimeError("metadata unavailable")
    calls = 0

    def build(_history: list[dict[str, Any]]) -> None:
        nonlocal calls
        calls += 1
        raise error

    with pytest.raises(RuntimeError, match="metadata unavailable") as raised:
        fit_browser_history(
            groups=[[{"role": "user", "content": "Question"}]],
            build=build,
            is_overflow=lambda failure: False,
        )

    assert raised.value is error
    assert calls == 1
