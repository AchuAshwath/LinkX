"""AI Content Curation and Constraint Validation Tools for LinkX Agentic Supervisor."""

from __future__ import annotations

import logging

from app.services.agentic.schemas import ComplianceReport
from app.services.ai_draft import generate_ai_post_draft
from app.services.browser.actions import normalize_post_text
from app.services.publishing import resolve_image_path

logger = logging.getLogger(__name__)


async def draft_social_post(
    *,
    topic_title: str,
    topic_summary: str | None = None,
    sample_tweets: list[str] | None = None,
    platform: str = "linkx",
    tone: str | None = None,
) -> str:
    """Generate platform-tailored post copy using LLM with fallback templates."""
    context_parts = [topic_title]
    if topic_summary:
        context_parts.append(f"Summary: {topic_summary}")
    if sample_tweets:
        context_parts.append("Key Tweets: " + " | ".join(sample_tweets[:3]))

    prompt = "\n".join(context_parts)
    return await generate_ai_post_draft(
        prompt=prompt,
        platform=platform,
        tone=tone,
    )


def validate_post_constraints(
    *,
    content: str,
    platform: str = "x",
    image_url: str | None = None,
    is_premium: bool = False,
) -> ComplianceReport:
    """Deterministically check character count limits, media path validity, and compliance."""
    violations: list[str] = []
    suggestions: list[str] = []

    normalized = normalize_post_text(content)
    char_count = len(normalized)

    # Determine max limits
    if platform.lower() == "linkedin":
        max_limit = 3000
    elif platform.lower() == "x":
        max_limit = 25000 if is_premium else 280
    else:  # 'linkx' or 'all'
        max_limit = 280  # Most restrictive

    if char_count > max_limit:
        violations.append(
            f"Content length ({char_count} chars) exceeds {platform.upper()} limit of {max_limit} characters."
        )
        suggestions.append(f"Trim {char_count - max_limit} characters.")

    if char_count == 0:
        violations.append("Post content is empty.")

    # Image check if provided
    if image_url:
        try:
            local_path = resolve_image_path(image_url=image_url)
            if not local_path.exists():
                violations.append(f"Referenced image not found on disk: {image_url}")
        except Exception as e:
            violations.append(f"Invalid image URL/path: {e}")

    # Check hashtag formatting
    if "#" not in content and platform.lower() in ("x", "linkedin", "linkx"):
        suggestions.append("Consider adding 1-2 relevant hashtags for discoverability.")

    return ComplianceReport(
        is_compliant=len(violations) == 0,
        char_count=char_count,
        max_limit=max_limit,
        platform=platform,
        violations=violations,
        suggestions=suggestions,
    )


async def refine_post_draft(
    *,
    content: str,
    platform: str,
    instructions: str,
) -> str:
    """Rewrite or adjust an existing post draft according to specific feedback/instructions."""
    refinement_prompt = (
        f"Original Post:\n{content}\n\n"
        f"Refinement Instructions:\n{instructions}\n\n"
        f"Rewrite this post specifically for {platform} adhering to all guidelines."
    )
    return await generate_ai_post_draft(
        prompt=refinement_prompt,
        platform=platform,
    )
