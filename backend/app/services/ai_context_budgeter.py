from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage

DEFAULT_TOKEN_BUDGET = 12000
TOOL_TRUNCATION_NOTICE = "[Output truncated to 300 chars...]"
HISTORICAL_SCRAPE_NOTICE = (
    "Historical tool scrape payload collapsed to conserve context window."
)


def _get_tiktoken_encoding(*, model: str | None) -> Any:
    import tiktoken

    try:
        if model:
            clean_model = model.removeprefix("openai/")
            return tiktoken.encoding_for_model(clean_model)
        return tiktoken.get_encoding("o200k_base")
    except Exception:
        return tiktoken.get_encoding("cl100k_base")


def count_tokens(*, text: str, model: str = "gpt-4o") -> int:
    """Accurately count tokens using tiktoken with robust encoding fallback."""
    if not isinstance(text, str) or not text:
        return 0
    try:
        encoding = _get_tiktoken_encoding(model=model)
        return len(encoding.encode(text))
    except Exception:
        return max(1, len(text) // 4)


def _estimate_list_content_tokens(*, content: list[Any], model: str = "gpt-4o") -> int:
    text_tokens = sum(
        count_tokens(text=str(part.get("text", "")), model=model)
        for part in content
        if isinstance(part, dict) and part.get("type") == "text"
    )
    img_tokens = sum(
        1000
        for part in content
        if isinstance(part, dict) and part.get("type") in ("image_url", "image")
    )
    return text_tokens + img_tokens


def estimate_message_tokens(
    *,
    message: BaseMessage | None,
    model: str = "gpt-4o",
) -> int:
    """Estimate token count for a single message including overhead and vision content."""
    if not message:
        return 4
    if isinstance(message.content, str):
        return count_tokens(text=message.content, model=model) + 4
    if isinstance(message.content, list):
        return _estimate_list_content_tokens(content=message.content, model=model) + 4
    return 4


def estimate_total_tokens(
    *,
    messages: list[BaseMessage],
    model: str = "gpt-4o",
) -> int:
    """Estimate total tokens across a list of LangChain messages."""
    return sum(estimate_message_tokens(message=msg, model=model) for msg in messages)


def _is_scrape_payload(*, output: Any) -> bool:
    return isinstance(output, dict) and bool(
        {"tweets", "topics_scraped"} & output.keys()
    )


def _prune_historical_tool_output(*, output: Any, max_chars: int = 300) -> Any:
    if _is_scrape_payload(output=output):
        return {
            "status": output.get("status", "success"),
            "summary": output.get("grok_summary") or HISTORICAL_SCRAPE_NOTICE,
        }
    if output is not None and len(str(output)) > max_chars:
        return TOOL_TRUNCATION_NOTICE
    return output


def _prune_dict_output(*, target: dict[str, Any], max_chars: int) -> dict[str, Any]:
    copy = dict(target)
    if "output" in copy:
        copy["output"] = _prune_historical_tool_output(
            output=copy["output"], max_chars=max_chars
        )
    return copy


def _prune_tool_part(
    *,
    part: Any,
    is_historical: bool,
    max_chars: int = 300,
) -> Any:
    if not is_historical or not isinstance(part, dict):
        return part
    if part.get("type") not in ("tool_call", "tool-call"):
        return part
    pruned = _prune_dict_output(target=part, max_chars=max_chars)
    if isinstance(pruned.get("tool"), dict):
        pruned["tool"] = _prune_dict_output(target=pruned["tool"], max_chars=max_chars)
    return pruned


def _prune_transcript_message(
    *,
    item: Any,
    is_historical: bool,
    max_chars: int = 300,
) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    raw_parts = item.get("parts", [])
    parts = (
        [
            _prune_tool_part(
                part=part, is_historical=is_historical, max_chars=max_chars
            )
            for part in raw_parts
        ]
        if isinstance(raw_parts, list)
        else []
    )
    return {**item, "parts": parts}


def _calculate_historical_cutoff(
    *,
    messages: list[Any],
    recent_turns_intact: int,
) -> int:
    """Calculate message index cutoff by counting conversational turns initiated by user."""
    if recent_turns_intact <= 0:
        return len(messages)
    user_indices = [
        idx
        for idx, item in enumerate(messages)
        if isinstance(item, dict) and item.get("role") == "user"
    ]
    if len(user_indices) <= recent_turns_intact:
        return 0
    return user_indices[-recent_turns_intact]


def prune_tool_call_outputs(
    *,
    transcript: dict[str, Any] | None,
    recent_turns_intact: int = 3,
    max_chars: int = 300,
) -> dict[str, Any] | None:
    """Collapse heavy scrape tool outputs on turns older than recent_turns_intact."""
    if not isinstance(transcript, dict):
        return None
    raw_msgs = transcript.get("messages", [])
    if not isinstance(raw_msgs, list):
        return {**transcript, "messages": []}

    cutoff_idx = _calculate_historical_cutoff(
        messages=raw_msgs,
        recent_turns_intact=recent_turns_intact,
    )
    cleaned_messages = [
        candidate_msg
        for idx, item in enumerate(raw_msgs)
        if (
            candidate_msg := _prune_transcript_message(
                item=item,
                is_historical=(idx < cutoff_idx),
                max_chars=max_chars,
            )
        )
        is not None
    ]
    return {**transcript, "messages": cleaned_messages}


def _group_messages_into_atomic_turns(
    *,
    messages: list[BaseMessage],
) -> list[list[BaseMessage]]:
    """Group messages into atomic turns: HumanMessage + (optional AIMessage + ToolMessage* + AIMessage)."""
    groups: list[list[BaseMessage]] = []
    current_group: list[BaseMessage] = []

    for msg in messages:
        if isinstance(msg, HumanMessage) and current_group:
            groups.append(current_group)
            current_group = [msg]
        else:
            current_group.append(msg)

    if current_group:
        groups.append(current_group)
    return groups


def _flatten_groups(*, groups: list[list[BaseMessage]]) -> list[BaseMessage]:
    return [msg for grp in groups for msg in grp]


def apply_sliding_window_budget(
    *,
    messages: list[BaseMessage],
    token_budget: int = DEFAULT_TOKEN_BUDGET,
    model: str = "gpt-4o",
) -> list[BaseMessage]:
    """Fit conversation history within token budget without orphaning ToolMessages."""
    if len(messages) <= 2:
        return messages
    sys_m = messages[0] if isinstance(messages[0], SystemMessage) else None
    non_sys = list(messages[1:] if sys_m else messages)
    prefix: list[BaseMessage] = [sys_m] if sys_m else []
    groups = _group_messages_into_atomic_turns(messages=non_sys)
    groups_window = list(groups)

    while groups_window:
        candidate = prefix + _flatten_groups(groups=groups_window)
        if estimate_total_tokens(messages=candidate, model=model) <= token_budget:
            return candidate
        groups_window.pop(0)

    fallback: list[BaseMessage] = []
    if groups and isinstance(groups[-1][0], HumanMessage):
        fallback = [groups[-1][0]]
    return prefix + fallback
