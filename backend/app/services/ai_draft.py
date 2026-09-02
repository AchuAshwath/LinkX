"""Service for generating and refining social media posts using AI."""

from __future__ import annotations

import os
import re
from typing import Any

from app.core.config import settings

SYSTEM_PROMPT = """You are an elite social media strategist and copywriter.
Generate an engaging, high-converting social media post based on the user's input/topic.
Do not include metadata, quotes around the entire post, or explanations. Only return the final post content."""


def _extract_clean_topic(prompt: str) -> str:
    """Extract clean subject topic from prompt, removing refinement instructions and headers."""
    cleaned = prompt.strip()
    if not cleaned:
        return "modern technology and AI automation"

    if "Original Post:" in cleaned:
        cleaned = cleaned.split("Original Post:")[1]
    if "Refinement Instructions:" in cleaned:
        cleaned = cleaned.split("Refinement Instructions:")[0]
    if "Rewrite this post" in cleaned:
        cleaned = cleaned.split("Rewrite this post")[0]
    if "Summary:" in cleaned:
        cleaned = cleaned.split("Summary:")[0]

    cleaned = re.sub(
        r"^(Platform:[^\n]+\n?)?(Topic/Input:\s*)?", "", cleaned, flags=re.IGNORECASE
    )
    cleaned = cleaned.strip(" :\n\"'")
    cleaned = re.sub(
        r"^Excited to share insights on\s*", "", cleaned, flags=re.IGNORECASE
    )
    cleaned = re.sub(r"^Most people think\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^Trending:\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip(" !.\n\"'")

    return cleaned if cleaned else "modern technology and AI automation"


def _generate_fallback_template(*, prompt: str, platform: str) -> str:
    """Generate platform-optimized social copy from topic, ensuring strict length compliance."""
    topic = _extract_clean_topic(prompt)
    plat = platform.lower()

    if plat in ("x", "both", "linkx"):
        words = topic.split()
        tag = re.sub(r"[^a-zA-Z0-9]", "", words[0]).capitalize() if words else "Tech"
        headline = (
            f"Key takeaway on {topic}:"
            if len(topic) < 60
            else f"{topic[:80].rstrip(' ,.-')}..."
        )

        post = (
            f"{headline}\n\n"
            f"• Prioritize core user value\n"
            f"• Automate workflows\n"
            f"• Iterate daily\n\n"
            f"#{tag} #Tech"
        )
        if len(post) > 275:
            post = f"{headline}\n\nDeliver real value with agile iteration.\n\n#{tag} #Tech"
        if len(post) > 275:
            post = f"{post[:270].rstrip(' ,.-')}..."
        return post

    if plat == "linkedin":
        return (
            f"The biggest shift happening in {topic} right now:\n\n"
            f"Teams that move fast aren't working longer hours.\n"
            f"They're leveraging intelligent systems to remove friction from execution.\n\n"
            f"Key insights we've learned:\n"
            f"• Simplicity always scales better than premature complexity\n"
            f"• Direct feedback loops beat endless planning\n"
            f"• Empowering creators with AI multiplies output 10x\n\n"
            f"How is your team approaching this in 2026? Drop your thoughts below.\n\n"
            f"#Innovation #Productivity #Engineering #Leadership"
        )

    return (
        f"Insights on {topic}:\n\n"
        f"Intelligent workflows and continuous iteration drive outsized impact.\n\n"
        f"#Productivity #Automation #Tech"
    )


def _resolve_ai_credentials() -> tuple[str | None, str, str]:
    """Resolve OpenAI-compatible API key, API base URL, and Model from settings."""
    api_key = (
        settings.OPENAI_API_COMPATIBLE_API_KEY
        or settings.AI_API_KEY
        or os.environ.get("OPENAI_API_COMPATIBLE_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
    )
    api_base = settings.OPENAI_API_COMPATIBLE_BASE_URL or settings.AI_API_BASE
    model = settings.AI_MODEL
    if api_base and not model.startswith("openai/"):
        model = f"openai/{model}"
    return api_key, api_base, model


async def generate_ai_post_draft(
    *,
    prompt: str = "",
    platform: str = "linkx",
    tone: str | None = None,
    model: str | None = None,
) -> str:
    """Generate an AI drafted post using LiteLLM if available, otherwise smart template."""
    api_key, api_base, default_model = _resolve_ai_credentials()
    target_model = model or default_model

    if api_key:
        try:
            import litellm

            tone_instruction = f" Tone: {tone}." if tone else ""
            user_msg = f"Platform: {platform}. Topic/Input: {prompt or 'Share a valuable tip for builders and creators.'}{tone_instruction}"

            completion_kwargs: dict[str, Any] = {
                "model": target_model,
                "api_key": api_key,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                "max_tokens": 800,
                "temperature": 0.7,
            }
            if api_base:
                completion_kwargs["api_base"] = api_base

            response = await litellm.acompletion(**completion_kwargs)
            content: str = response.choices[0].message.content.strip()
            if content:
                return content
        except Exception:
            # Fall back to template generator on any provider error
            pass

    return _generate_fallback_template(prompt=prompt, platform=platform)
