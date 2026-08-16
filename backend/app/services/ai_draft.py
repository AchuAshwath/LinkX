"""Service for generating and refining social media posts using AI."""

from __future__ import annotations

import os
import re

SYSTEM_PROMPT = """You are an elite social media strategist and copywriter.
Generate an engaging, high-converting social media post based on the user's input/topic.
Do not include metadata, quotes around the entire post, or explanations. Only return the final post content."""


def _generate_fallback_template(*, prompt: str, platform: str) -> str:
    cleaned = prompt.strip()
    topic = cleaned if cleaned else "building modern software with AI and automation"

    if platform.lower() == "x":
        words = topic.split()
        tag = re.sub(r"[^a-zA-Z0-9]", "", words[0]).capitalize() if words else "Tech"
        return (
            f"Most people think {topic} is complicated.\n\n"
            f"Here is the real playbook in 3 steps:\n"
            f"1. Focus on core user value\n"
            f"2. Automate repetitive workflows\n"
            f"3. Iterate daily based on real signals\n\n"
            f"What's your biggest takeaway? #{tag} #BuildInPublic"
        )

    if platform.lower() == "linkedin":
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
        f"Excited to share insights on {topic}!\n\n"
        f"Leveraging intelligent tooling and streamlined workflows makes all the difference.\n\n"
        f"Key takeaway: Keep building, keep iterating, and focus on delivering real value.\n\n"
        f"#Productivity #Automation #Tech"
    )


async def generate_ai_post_draft(
    *,
    prompt: str = "",
    platform: str = "linkx",
    tone: str | None = None,
) -> str:
    """Generate an AI drafted post using LiteLLM if available, otherwise smart template."""
    api_key_present = bool(
        os.environ.get("OPENAI_API_KEY")
        or os.environ.get("ANTHROPIC_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GROQ_API_KEY")
        or os.environ.get("OLLAMA_API_BASE")
    )

    if api_key_present:
        try:
            import litellm

            model = os.environ.get("AI_MODEL", "gpt-4o-mini")
            tone_instruction = f" Tone: {tone}." if tone else ""
            user_msg = f"Platform: {platform}. Topic/Input: {prompt or 'Share a valuable tip for builders and creators.'}{tone_instruction}"

            response = await litellm.acompletion(
                model=model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=800,
                temperature=0.7,
            )
            content: str = response.choices[0].message.content.strip()
            if content:
                return content
        except Exception:
            # Fall back to template generator on any provider error
            pass

    return _generate_fallback_template(prompt=prompt, platform=platform)
