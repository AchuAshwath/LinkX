"""Safe, whole-turn projections of chat history for browser questions."""

from collections.abc import Callable
from itertools import chain
from typing import Any, TypeVar, cast

_ATTACHMENT_PLACEHOLDER = "[Earlier attachment omitted from browser context.]"
_Result = TypeVar("_Result")


def _text_content(*, message: dict[str, Any]) -> tuple[str, bool]:
    parts = message.get("parts")
    if isinstance(parts, list):
        return _parts_content(parts=parts)
    return _legacy_content(content=message.get("content"))


def _legacy_content(*, content: Any) -> tuple[str, bool]:
    if not isinstance(content, str):
        return "", content is not None
    if content.lstrip().lower().startswith("data:"):
        return "", True
    return content, False


def _parts_content(*, parts: list[Any]) -> tuple[str, bool]:
    text_parts: list[str] = []
    has_attachment = False
    for part in parts:
        text, is_attachment = _part_text(part=part)
        has_attachment = has_attachment or is_attachment
        text_parts.append(text)
    return "".join(text_parts), has_attachment


def _part_text(*, part: Any) -> tuple[str, bool]:
    if not isinstance(part, dict) or part.get("type") != "text":
        return "", True
    text = part.get("text")
    if not isinstance(text, str):
        return "", False
    if text.lstrip().lower().startswith("data:"):
        return "", True
    return text, False


def _project_message(*, message: dict[str, Any]) -> dict[str, Any] | None:
    role = message.get("role")
    if role not in {"user", "assistant"}:
        return None
    content, has_attachment = _text_content(message=message)
    if role == "user" and has_attachment:
        content = _with_attachment_placeholder(content=content)
    if role == "assistant" and not content:
        return None
    return {"role": role, "content": content}


def _with_attachment_placeholder(*, content: str) -> str:
    if content:
        return f"{content}\n{_ATTACHMENT_PLACEHOLDER}"
    return _ATTACHMENT_PLACEHOLDER


def _append_turn_message(
    *, groups: list[list[dict[str, Any]]], message: dict[str, Any]
) -> None:
    if message["role"] == "user":
        groups.append([message])
    elif groups:
        groups[-1].append(message)
    else:
        groups.append([message])


def project_browser_history(
    *, history: list[dict[str, Any]]
) -> list[list[dict[str, Any]]]:
    """Keep only safe text and group it into complete chronological user turns."""
    groups: list[list[dict[str, Any]]] = []
    for message in history:
        projected = _project_message(message=message)
        if projected is not None:
            _append_turn_message(groups=groups, message=projected)
    return groups


def _attempt_build(
    *,
    history: list[dict[str, Any]],
    build: Callable[[list[dict[str, Any]]], _Result],
    is_overflow: Callable[[Exception], bool],
) -> tuple[bool, _Result | None, Exception | None]:
    try:
        return True, build(history), None
    except Exception as error:
        if is_overflow(error):
            return False, None, error
        raise


def _fit_recent_suffix(
    *,
    groups: list[list[dict[str, Any]]],
    best: _Result,
    build: Callable[[list[dict[str, Any]]], _Result],
    is_overflow: Callable[[Exception], bool],
) -> _Result:
    low = 0
    high = len(groups)
    while low + 1 < high:
        keep_count = (low + high) // 2
        suffix = list(chain.from_iterable(groups[-keep_count:]))
        fits, candidate, _ = _attempt_build(
            history=suffix, build=build, is_overflow=is_overflow
        )
        if fits:
            low = keep_count
            best = cast(_Result, candidate)
        else:
            high = keep_count
    return best


def fit_browser_history(
    *,
    groups: list[list[dict[str, Any]]],
    build: Callable[[list[dict[str, Any]]], _Result],
    is_overflow: Callable[[Exception], bool],
) -> _Result:
    """Build with the largest recent whole-turn suffix that fits."""
    full_history = list(chain.from_iterable(groups))
    fits, result, full_error = _attempt_build(
        history=full_history, build=build, is_overflow=is_overflow
    )
    if fits:
        return cast(_Result, result)
    if not groups:
        raise cast(Exception, full_error)

    fits, best, minimum_error = _attempt_build(
        history=[], build=build, is_overflow=is_overflow
    )
    if not fits:
        raise cast(Exception, minimum_error)
    return _fit_recent_suffix(
        groups=groups,
        best=cast(_Result, best),
        build=build,
        is_overflow=is_overflow,
    )
