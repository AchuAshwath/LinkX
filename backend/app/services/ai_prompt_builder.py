"""Message history and prompt construction for LinkX AI Copilot."""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
)

from app.services.ai_context_budgeter import (
    DEFAULT_TOKEN_BUDGET,
    apply_sliding_window_budget,
    estimate_total_tokens,
    prune_tool_call_outputs,
)
from app.services.ai_image_utils import normalize_image_url, sanitize_image_urls

logger = logging.getLogger(__name__)

LINKX_SYSTEM_PROMPT = """You are LinkX Copilot — an expert social media strategist, copywriter, and viral growth advisor.
You help users craft high-performing, engaging posts for LinkedIn, X (Twitter), and cross-platform growth.

Your capabilities:
- Draft compelling hooks, thought leadership articles, and viral thread openers.
- Rewrite and refine drafts for clarity, punchiness, engagement, and platform fit.
- Suggest strategic hashtags, strong calls-to-action (CTAs), and formatting improvements.
- Advise on posting strategy, timing, tone of voice, and audience engagement.
- Answer questions about social media growth and content strategy.

Guidelines:
- First, briefly outline your strategic thinking, angle, and platform tone inside <thought>...</thought> tags.
- Then, provide your final response or post content cleanly outside the tags.
- Format responses cleanly with Markdown, clear paragraph breaks, and bullet points where helpful.
- Respect platform constraints (X: 280 chars or 25,000 for Premium; LinkedIn: up to 3,000 chars).
"""


def _extract_text_from_parts(parts: list[dict[str, Any]] | None) -> str:
    """Extract concatenated text content from message parts."""
    if not isinstance(parts, list):
        return ""
    text_chunks = [
        str(part.get("text", ""))
        for part in parts
        if isinstance(part, dict) and part.get("type") == "text" and part.get("text")
    ]
    return "\n".join(text_chunks).strip()


def _extract_thought_from_parts(parts: list[dict[str, Any]] | None) -> str:
    """Extract concatenated thought content from message parts."""
    if not isinstance(parts, list):
        return ""
    thoughts = [
        str(part.get("content", ""))
        for part in parts
        if isinstance(part, dict)
        and part.get("type") == "thought"
        and part.get("content")
    ]
    return "\n".join(thoughts).strip()


def _build_assistant_history_content(thought: str, text: str) -> str:
    if thought and text:
        return f"<thought>{thought}</thought>\n\n{text}"
    if thought:
        return f"<thought>{thought}</thought>"
    return text


def _extract_image_url_from_part(part: dict[str, Any]) -> str:
    """Extract raw image URL or base64 from a part."""
    if not isinstance(part, dict) or part.get("type") not in ("image_url", "image"):
        return ""
    img_val = part.get("image_url")
    if isinstance(img_val, dict):
        return str(img_val.get("url", "")).strip()
    if isinstance(img_val, str):
        return img_val.strip()
    return str(part.get("url", "")).strip()


def _extract_single_image(part: dict[str, Any]) -> str | None:
    raw_url = _extract_image_url_from_part(part)
    return normalize_image_url(url=raw_url) if raw_url else None


def _extract_images_from_parts(parts: list[dict[str, Any]] | None) -> list[str]:
    """Extract and normalize image URLs from message parts."""
    if not isinstance(parts, list):
        return []
    return [
        img for p in parts if isinstance(p, dict) and (img := _extract_single_image(p))
    ]


def _build_human_message_content(
    text: str, images: list[str] | None = None
) -> str | list[str | dict[Any, Any]]:
    if not images:
        return text or "[Empty message]"
    content: list[str | dict[Any, Any]] = []
    if text:
        content.append({"type": "text", "text": text})
    for img in images:
        if img:
            content.append({"type": "image_url", "image_url": {"url": img}})
    return content


def _convert_user_turn(text: str, images: list[str]) -> HumanMessage | None:
    if not text and not images:
        return None
    return HumanMessage(content=_build_human_message_content(text, images))


def _get_draft_field(
    primary: dict[str, Any], fallback: dict[str, Any], *keys: str, default: str = ""
) -> str:
    for k in keys:
        val = primary.get(k) or fallback.get(k)
        if val:
            return str(val)
    return default


def _format_draft_block(*, content: str, post_id: str, platform: str) -> str:
    id_str = f" (Post ID: {post_id})" if post_id else ""
    return f"[Draft Post{id_str}, Platform: {platform or 'x'}]:\n{content}"


def _extract_draft_block_from_artifact(part: dict[str, Any]) -> str | None:
    if not isinstance(part, dict) or part.get("type") != "draft_artifact":
        return None
    raw_art = part.get("artifact")
    art: dict[str, Any] = raw_art if isinstance(raw_art, dict) else {}
    content = _get_draft_field(art, part, "content")
    if not content:
        return None
    post_id = _get_draft_field(art, part, "postId", "id", "post_id")
    platform = _get_draft_field(art, part, "platform", default="x")
    return _format_draft_block(content=content, post_id=post_id, platform=platform)


def _extract_output_payload(output: Any) -> tuple[str | None, str, str]:
    if isinstance(output, dict) and output.get("content"):
        p_id = output.get("post_id") or output.get("id") or ""
        return output["content"], str(p_id), str(output.get("platform", "x"))
    return None, "", "x"


def _extract_input_payload(inp: Any) -> tuple[str | None, str, str]:
    if isinstance(inp, dict):
        content = inp.get("content") or inp.get("refined_content")
        if content:
            return content, str(inp.get("post_id", "")), str(inp.get("platform", "x"))
    return None, "", "x"


def _extract_tool_payload(
    tool_data: dict[str, Any], part: dict[str, Any]
) -> tuple[str | None, str, str]:
    content, p_id, plat = _extract_output_payload(
        tool_data.get("output") or part.get("output")
    )
    if content:
        return content, p_id, plat
    return _extract_input_payload(tool_data.get("input") or part.get("input"))


def _extract_draft_block_from_tool_call(part: dict[str, Any]) -> str | None:
    if not isinstance(part, dict) or part.get("type") not in ("tool-call", "tool_call"):
        return None
    tool_val = part.get("tool")
    tool_dict = tool_val if isinstance(tool_val, dict) else {}
    name = part.get("name") or tool_dict.get("name")
    if name not in ("save_draft_post", "update_draft_post"):
        return None
    content, post_id, platform = _extract_tool_payload(tool_dict, part)
    if not content:
        return None
    return _format_draft_block(content=content, post_id=post_id, platform=platform)


def _extract_single_assistant_block(part: dict[str, Any]) -> str | None:
    draft = _extract_draft_block_from_artifact(part)
    if draft:
        return draft
    tool_draft = _extract_draft_block_from_tool_call(part)
    if tool_draft:
        return tool_draft
    if part.get("type") == "text" and part.get("text"):
        return str(part["text"])
    return None


def _extract_assistant_content_from_parts(parts: list[dict[str, Any]]) -> str:
    """Extract full conversational content including text and draft artifacts from assistant parts."""
    if not isinstance(parts, list):
        return ""
    blocks = [
        blk
        for p in parts
        if isinstance(p, dict) and (blk := _extract_single_assistant_block(p))
    ]
    return "\n\n".join(b.strip() for b in blocks if b.strip()).strip()


def _convert_assistant_turn(
    thought: str, parts: list[dict[str, Any]]
) -> AIMessage | None:
    content = _extract_assistant_content_from_parts(parts)
    if not content and not thought:
        return None
    return AIMessage(
        content=_build_assistant_history_content(thought=thought, text=content)
    )


def _convert_transcript_item(item: dict[str, Any]) -> BaseMessage | None:
    if not isinstance(item, dict):
        return None
    role = item.get("role")
    parts = item.get("parts", [])
    if not isinstance(parts, list):
        parts = []
    if role == "user":
        text = _extract_text_from_parts(parts)
        images = _extract_images_from_parts(parts)
        return _convert_user_turn(text, images)
    if role == "assistant":
        thought = _extract_thought_from_parts(parts)
        return _convert_assistant_turn(thought, parts)
    return None


def _ensure_latest_human_message(
    converted: list[BaseMessage],
    current_message: str,
    images: list[str] | None = None,
) -> None:
    user_turn = _convert_user_turn(current_message, images or [])
    if not user_turn:
        return
    if converted and isinstance(converted[-1], HumanMessage):
        converted[-1] = user_turn
    else:
        converted.append(user_turn)


def _convert_transcript_messages(
    transcript: dict[str, Any] | None,
) -> list[BaseMessage]:
    raw = transcript.get("messages", []) if isinstance(transcript, dict) else []
    if not isinstance(raw, list):
        return []
    return [msg for item in raw if (msg := _convert_transcript_item(item)) is not None]


def _assemble_prompt_messages(
    transcript: dict[str, Any] | None,
    current_message: str,
    images: list[str] | None,
    max_history: int,
) -> list[BaseMessage]:
    converted = _convert_transcript_messages(transcript)
    _ensure_latest_human_message(converted, current_message, images=images)
    trimmed = converted[-max_history:] if len(converted) > max_history else converted
    return [SystemMessage(content=LINKX_SYSTEM_PROMPT), *trimmed]


def build_message_history(
    *,
    transcript: dict[str, Any] | None,
    current_message: str,
    images: list[str] | None = None,
    **kwargs: Any,
) -> list[BaseMessage]:
    """Convert JSONB transcript into LangChain messages with token-aware context budgeting."""
    max_hist = int(kwargs.get("max_history_messages", 10))
    budget = int(kwargs.get("token_budget", DEFAULT_TOKEN_BUDGET))
    model = kwargs.get("model")
    clean_images = sanitize_image_urls(images=images) if images else None

    base_msgs = _assemble_prompt_messages(
        transcript, current_message, clean_images, max_hist
    )
    if estimate_total_tokens(base_msgs, model=model) <= budget:
        return base_msgs

    pruned = prune_tool_call_outputs(transcript, max_chars=300)
    pruned_msgs = _assemble_prompt_messages(
        pruned, current_message, clean_images, max_hist
    )
    if estimate_total_tokens(pruned_msgs, model=model) <= budget:
        return pruned_msgs

    return apply_sliding_window_budget(pruned_msgs, token_budget=budget, model=model)


_build_message_history = build_message_history
