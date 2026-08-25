"""Live demonstration script for DraftRefinementGraph (Tier 1 Shared Adaptive Subgraph).

Usage:
    cd backend && uv run python scripts/demo_draft_refinement.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Add backend directory to sys.path
sys.path.append(str(Path(__file__).parent.parent))

from app.services.agentic import refine_draft_with_graph


async def main() -> None:
    print("=" * 70)
    print("🚀 LIVE DEMO: DraftRefinementGraph (Tier 1 Shared Adaptive Subgraph)")
    print("=" * 70)

    # 1. Provide an intentionally oversized draft
    sample_content = (
        "We are super thrilled to finally unveil LinkX's revolutionary autonomous "
        "social media agent supervisor! It features an adaptive self-healing selector "
        "engine that monitors DOM state in real time, automatically repairs outdated "
        "locators using Gemini 3.7 Flash models, and ensures zero broken posting runs "
        "ever again across X and LinkedIn. Check out our comprehensive open-source "
        "codebase on GitHub right now and let us know what you build with it! "
        "#AI #DevTools #MachineLearning #AutonomousAgents #Python #FastAPI #Playwright"
    )

    print(f"\n[Original Draft] ({len(sample_content)} characters):")
    print("-" * 70)
    print(sample_content)
    print("-" * 70)

    print("\nTarget Platform: X (Standard 280-char limit)")
    print("Target Tone: punchy, authoritative, engineering-focused")
    print("Executing DraftRefinementGraph StateMachine...\n")

    # 2. Execute graph
    report = await refine_draft_with_graph(
        content=sample_content,
        platform="x",
        target_tone="punchy, authoritative, engineering-focused",
        max_attempts=2,
    )

    # 3. Print structured output
    print("=" * 70)
    print(f"🎯 REFINEMENT RESULT (Status: {report.status.upper()})")
    print("=" * 70)
    print(f"Compliant:  {'✅ YES' if report.is_compliant else '❌ NO'}")
    print(f"Attempts:   {report.attempts}")
    print(f"Char Count: {len(report.refined_content)} / 280 limit")
    print("\n[Refined Content]:")
    print("-" * 70)
    print(report.refined_content)
    print("-" * 70)

    if report.compliance_report:
        print(f"\nSuggestions: {report.compliance_report.get('suggestions', [])}")


if __name__ == "__main__":
    asyncio.run(main())
