from typing import Any

from langchain_core.messages import BaseMessage, SystemMessage

DEFAULT_TOKEN_BUDGET = 12000
TOOL_TRUNCATION_NOTICE = "[Output truncated to 300 chars...]"


def _get_tiktoken_encoding(clean_model: str | None) -> Any:
    import tiktoken

    try:
        return (
            tiktoken.encoding_for_model(clean_model)
            if clean_model
            else tiktoken.get_encoding("o200k_base")
        )
    except Exception:
        return tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str, *, model: str | None = None) -> int:
    if not text or not isinstance(text, str):
        return 0
    try:
        clean_model = model.removeprefix("openai/") if model else None
        encoding = _get_tiktoken_encoding(clean_model)
        return len(encoding.encode(text))
    except Exception:
        return max(1, len(text) // 4)


def _estimate_list_content_tokens(
    content: list[Any], *, model: str | None = None
) -> int:
    text_tokens = sum(
        count_tokens(str(i.get("text", "")), model=model)
        for i in content
        if isinstance(i, dict) and i.get("type") == "text"
    )
    img_tokens = sum(
        300
        for i in content
        if isinstance(i, dict) and i.get("type") in ("image_url", "image")
    )
    return text_tokens + img_tokens


def estimate_message_tokens(message: BaseMessage, *, model: str | None = None) -> int:
    content = message.content
    if isinstance(content, str):
        return count_tokens(content, model=model) + 4
    if isinstance(content, list):
        return _estimate_list_content_tokens(content, model=model) + 4
    return 4


def estimate_total_tokens(
    messages: list[BaseMessage], *, model: str | None = None
) -> int:
    return sum(estimate_message_tokens(m, model=model) for m in messages)


def _truncate_output_val(val: Any, max_chars: int) -> Any:
    if val is not None and len(str(val)) > max_chars:
        return TOOL_TRUNCATION_NOTICE
    return val


def _prune_tool_part(part: Any, *, max_chars: int = 300) -> Any:
    if not isinstance(part, dict) or part.get("type") not in ("tool_call", "tool-call"):
        return part
    pruned = dict(part)
    if "output" in pruned:
        pruned["output"] = _truncate_output_val(pruned.get("output"), max_chars)
    tool_val = pruned.get("tool")
    if isinstance(tool_val, dict):
        tool_copy = dict(tool_val)
        tool_copy["output"] = _truncate_output_val(tool_copy.get("output"), max_chars)
        pruned["tool"] = tool_copy
    return pruned


def _prune_transcript_message(item: Any, max_chars: int) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    raw_parts = item.get("parts", [])
    parts = (
        [_prune_tool_part(p, max_chars=max_chars) for p in raw_parts]
        if isinstance(raw_parts, list)
        else []
    )
    return {**item, "parts": parts}


def prune_tool_call_outputs(
    transcript: dict[str, Any] | None, *, max_chars: int = 300
) -> dict[str, Any] | None:
    if not isinstance(transcript, dict):
        return None
    raw_msgs = transcript.get("messages", [])
    if not isinstance(raw_msgs, list):
        return {**transcript, "messages": []}
    msgs = [
        p_msg
        for item in raw_msgs
        if (p_msg := _prune_transcript_message(item, max_chars)) is not None
    ]
    return {**transcript, "messages": msgs}


def _find_window_within_budget(
    mid: list[BaseMessage],
    pinned: tuple[SystemMessage | None, BaseMessage],
    token_budget: int,
    model: str | None = None,
) -> list[BaseMessage]:
    sys_m, latest = pinned
    while mid:
        cand = [sys_m, *mid, latest] if sys_m else [*mid, latest]
        if estimate_total_tokens(cand, model=model) <= token_budget:
            return cand
        mid.pop(0)
    return [sys_m, latest] if sys_m else [latest]


def apply_sliding_window_budget(
    messages: list[BaseMessage],
    *,
    token_budget: int = DEFAULT_TOKEN_BUDGET,
    model: str | None = None,
) -> list[BaseMessage]:
    if len(messages) <= 2:
        return messages
    sys_m = messages[0] if isinstance(messages[0], SystemMessage) else None
    latest = messages[-1]
    mid = list(messages[1:-1] if sys_m else messages[:-1])
    return _find_window_within_budget(mid, (sys_m, latest), token_budget, model=model)
