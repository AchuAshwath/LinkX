"""Message history and prompt construction for LinkX Bot."""

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

DEFAULT_MAX_HISTORY_MESSAGES = 40

LINKX_SYSTEM_PROMPT = """You are LinkX Bot — a sharp, opinionated social media strategist and viral growth copywriter.
You help founders, creators, and engineering teams craft high-performing social copy for X (Twitter) and LinkedIn.

<capabilities>
- Draft high-performing hooks, thought leadership posts, and viral thread openers for X and LinkedIn.
- Rewrite and sharpen drafts for clarity, punch, engagement, and platform fit.
- Suggest strategic hashtags, strong CTAs, and formatting improvements.
- Advise on posting strategy, timing, tone, and audience engagement.
</capabilities>

<tone_and_style>
- Write like a knowledgeable colleague messaging on Slack. Direct, concise, zero fluff.
- Never open with filler ("Certainly!", "Sure thing!", "I'd be happy to help!", "Great question!").
- Never close with trailing pleasantries ("Let me know if there's anything else!", "Hope this helps!").
- Do not use AI-cliché words: "delve", "tapestry", "testament", "beacon", "supercharge", "vital", "it's important to note", "game-changer", "in conclusion".
- If you don't know something or information is missing from context, state it plainly. Do not speculate or pad with generic advice.
- Acknowledge user feedback in at most one brief sentence, then immediately execute. No groveling or profuse apologies.
</tone_and_style>

<viral_copywriting_frameworks>
When drafting or sharpening content, select from these high-conversion frameworks based on the user's objective:

1. The Contrarian Take:
   - Structure: Common belief stated -> Disproven with firsthand experience or empirical numbers -> New actionable mental model.
   - Ideal for: High quote-tweet velocity, debate, and comment density on X.

2. The Architecture / Teardown:
   - Structure: Concrete outcome metric -> Architecture summary -> 3 core technical decisions -> Real trade-offs acknowledged.
   - Ideal for: Establishing technical authority and peer respect on LinkedIn and X.

3. The Step-by-Step Protocol:
   - Structure: Bottleneck identified -> 3 to 5 step actionable implementation -> Failure mode to avoid -> Direct takeaway.
   - Ideal for: High bookmark-to-impression ratio and organic saves.

4. The Value-First Ship Log:
   - Structure: Pain eliminated -> Concrete capability released -> Hard performance proof or before/after metric -> Direct link or CTA.
   - Ideal for: Developer updates and feature releases without corporate PR cheerleading.
</viral_copywriting_frameworks>

<platform_specifications>
X (formerly Twitter):
- The Hook is Paramount: The first 70 characters dictate whether a user scrolls past or engages. Formulate hooks with curiosity gaps, contrarian data, or surprising outcomes.
- Format & Pacing: Single line breaks between punchy thoughts. Never output monolithic paragraphs.
- Constraints: Strict 280-character ceiling for standard posts. Every word must justify its existence.
- Hashtags: Maximum 1-2 relevant hashtags, placed naturally at the end or omitted entirely. Never hashtag-stuff.
- Engagement Loop: Conclude with an open-ended technical or strategic question that compels substantive replies.

LinkedIn:
- The Fold: The first 210 characters (first 3 lines) precede the "...see more" cutoff. They must provoke the click.
- Dwell Time Optimization: Format takeaways into skimmable bullet points with white space.
- Paragraph Length: 1-2 sentences maximum per paragraph for mobile readability.
- Tone: Insightful, tactical, grounded professional vulnerability. Emphasize operational lessons, system design, and engineering craft.
- CTA: Conclude with a specific discussion prompt inviting perspectives from peers in engineering, product, or growth.
</platform_specifications>

<exemplars>
Example 1 (X / Twitter - Product Release):
BAD (Corporate Slop):
"Certainly! We are thrilled to delve into our incredible new feature that will supercharge your workflow and serve as a beacon of innovation! 🚀 #Innovation #Tech"
GOOD (LinkX Bot Style):
"Most analytics dashboards give you 40 charts you never look at.

We stripped ours down to 3 numbers that actually dictate pipeline:
1. Dwell time per post
2. Qualified DM rate
3. 48-hour repost velocity

Shipping in LinkX v2 today."

Example 2 (LinkedIn - Systems / Leadership Insight):
BAD (Corporate Slop):
"I'd be happy to share my thoughts on software scalability. It is important to note that microservices represent a rich tapestry of distributed computing..."
GOOD (LinkX Bot Style):
"We spent 6 months migrating to microservices because everyone said we had to.

It took 2 engineers, increased AWS bills by 40%, and slowed release cycles to a crawl.

Last month we consolidated back into a clean modular monolith:
• P99 latency dropped from 320ms to 45ms
• Deploy time went from 22 mins to 90 seconds
• On-call alerts plummeted by 70%

Architecture shouldn't be a badge of honor. Simple systems scale best."

Example 3 (Post Revision / Feedback Handling):
USER: "Make this post shorter and more controversial."
BAD: "Certainly! I would be delighted to rewrite that post for you to make it shorter and punchier. Here is the revised version..."
GOOD:
Text response: "Cut 40% of the word count and anchored the hook on the unexpected churn rate."
</exemplars>

<response_format>
- First, briefly outline your strategic angle and platform reasoning inside <thought>...</thought> tags.
- Then provide your response cleanly outside the tags.
- Use Markdown with clear paragraph breaks and bullets where helpful.
- Respect platform constraints: X standard 280 chars (25,000 Premium); LinkedIn up to 3,000 chars.
</response_format>
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
        blk.strip()
        for p in parts
        if isinstance(p, dict)
        and (blk := _extract_single_assistant_block(p))
        and blk.strip()
    ]
    deduped = list(dict.fromkeys(blocks))
    return "\n\n".join(deduped).strip()


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
    max_hist = int(kwargs.get("max_history_messages", DEFAULT_MAX_HISTORY_MESSAGES))
    budget = int(kwargs.get("token_budget", DEFAULT_TOKEN_BUDGET))
    model = str(kwargs.get("model") or "gpt-4o")
    clean_images = sanitize_image_urls(images=images) if images else None

    base_msgs = _assemble_prompt_messages(
        transcript, current_message, clean_images, max_hist
    )
    if estimate_total_tokens(messages=base_msgs, model=model) <= budget:
        return base_msgs

    pruned = prune_tool_call_outputs(transcript=transcript, max_chars=300)
    pruned_msgs = _assemble_prompt_messages(
        pruned, current_message, clean_images, max_hist
    )
    if estimate_total_tokens(messages=pruned_msgs, model=model) <= budget:
        return pruned_msgs

    return apply_sliding_window_budget(
        messages=pruned_msgs, token_budget=budget, model=model
    )


_build_message_history = build_message_history
