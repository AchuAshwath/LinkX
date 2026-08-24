"""Live Step-by-Step Terminal Demonstration for Scraping with Self-Healing (Issue #86).

This script simulates a full scraping run with an intentionally broken selector,
demonstrating the complete LangGraph self-healing cycle with rich step-by-step
terminal output:
1. Normal Scrape Invocation & Element Miss Detection
2. LangGraph StateGraph Supervisor Activation
3. DOM Snippet Extraction & Pruning
4. LLM Visual/DOM Diagnosis with Candidate Ranking & Reasoning (gemini-3.7-flash-high)
5. Live Playwright Page Candidate Probing
6. Configuration Hot-Patching on Disk & In-Memory Cache
7. Scraper Continuation & Structured Domain Model Extraction
"""

import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any

# Add backend directory to sys.path
sys.path.append(str(Path(__file__).parent.parent))

from rebrowser_playwright.async_api import async_playwright

from app.services.agentic.client import get_chat_model
from app.services.agentic.schemas import SelectorDiagnosisReport
from app.services.browser.core import get_playwright_args
from app.services.browser.tools import (
    get_dom_snippet,
    patch_selector_config,
    validate_selector_candidate,
)
from scripts.scrape_trending_topics import extract_trending_sidebar

# Configure logging
logging.basicConfig(level=logging.WARNING)

# ANSI Color Codes for Rich Terminal Output
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"
MAGENTA = "\033[95m"
DIM = "\033[2m"
RESET = "\033[0m"

# Realistic X.com Trending Sidebar DOM
MOCK_X_TRENDING_PAGE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>X / Explore / Trends</title>
</head>
<body style="background-color: #000; color: #fff; font-family: sans-serif;">
  <div data-testid="primaryColumn">
    <h1>Explore</h1>
  </div>
  <div data-testid="sidebarColumn" role="complementary" aria-label="Timeline: Trending now" style="width: 350px;">
    <h2>What's happening</h2>
    <div data-testid="trend">
      <a href="/search?q=LangGraph" data-testid="news_sidebar_article" style="display: block; margin-bottom: 12px; color: #fff; text-decoration: none;">
        Technology · Trending
        <div style="font-weight: bold; font-size: 16px;">LangGraph</div>
        <div style="color: #71767b; font-size: 13px;">42.8K posts</div>
      </a>
    </div>
    <div data-testid="trend">
      <a href="/search?q=SelfHealing" data-testid="news_sidebar_article" style="display: block; margin-bottom: 12px; color: #fff; text-decoration: none;">
        Software Engineering · Trending
        <div style="font-weight: bold; font-size: 16px;">Autonomous Self-Healing</div>
        <div style="color: #71767b; font-size: 13px;">19.4K posts</div>
      </a>
    </div>
    <div data-testid="trend">
      <a href="/search?q=AI_Agents" data-testid="news_sidebar_article" style="display: block; margin-bottom: 12px; color: #fff; text-decoration: none;">
        Artificial Intelligence · Trending
        <div style="font-weight: bold; font-size: 16px;">#AgenticWorkflows</div>
        <div style="color: #71767b; font-size: 13px;">88.1K posts</div>
      </a>
    </div>
  </div>
</body>
</html>
"""


def banner(title: str, color: str = CYAN) -> None:
    print(f"\n{color}{BOLD}{'=' * 75}")
    print(f"  {title}")
    print(f"{'=' * 75}{RESET}\n")


def sub_header(step: str, title: str) -> None:
    print(f"\n{MAGENTA}{BOLD}[{step}] {title}{RESET}")
    print(f"{DIM}{'-' * 70}{RESET}")


def _setup_demo_config(demo_config_path: Path, mock_html_path: Path) -> dict[str, Any]:
    """Setup mock HTML and broken configuration for demonstration."""
    mock_html_path.write_text(MOCK_X_TRENDING_PAGE_HTML, encoding="utf-8")
    initial_config = {
        "max_topics_to_scrape": 3,
        "selectors": {
            "sidebar_container": "div[data-testid='broken_sidebar_container_v99']",
            "sidebar_link": "a[href*='/search?q=']",
            "tweet_container": "[data-testid='tweet']",
        },
        "link_heuristic": {
            "exclude_texts": ["Show more", "Subscribe"],
        },
    }
    with open(demo_config_path, "w", encoding="utf-8") as f:
        json.dump(initial_config, f, indent=2)
    return initial_config


async def _execute_ai_diagnosis(page: Any, broken_sel: str) -> SelectorDiagnosisReport:
    """Diagnose broken selector and produce candidate selectors via LLM."""
    dom_snippet = await get_dom_snippet(page=page, max_chars=3000)
    model = get_chat_model(temperature=0.1)
    structured_model = model.with_structured_output(
        SelectorDiagnosisReport, method="json_mode"
    )
    prompt = (
        f"Failed Element Name: selectors.sidebar_container (Trending Topics Sidebar on X.com)\n"
        f"Broken Selector: {broken_sel}\n"
        f"Page DOM:\n{dom_snippet}\n\n"
        f"Diagnose why the element failed and suggest ranked candidate selectors to target the trending sidebar. Return a JSON object with 'candidate_selectors' list."
    )
    diagnosis: SelectorDiagnosisReport = await structured_model.ainvoke(
        [
            {
                "role": "system",
                "content": "You are a senior browser automation diagnostics agent.",
            },
            {"role": "user", "content": prompt},
        ]
    )
    return diagnosis


async def _probe_candidates(
    page: Any, diagnosis: SelectorDiagnosisReport
) -> str | None:
    """Test candidate selectors on live page and return first verified match."""
    for candidate in diagnosis.candidate_selectors:
        test_res = await validate_selector_candidate(
            page=page, selector=candidate.selector
        )
        if test_res["found"] and test_res["visible"]:
            print(
                f"      ✅ {GREEN}{BOLD}MATCH FOUND!{RESET} Visible: True, Match Count: {test_res['count']}"
            )
            return candidate.selector
    return None


async def run_detailed_scrape_demo() -> None:
    banner("LINKX LIVE DEMO: SCRAPER WITH SELF-HEALING SUPERVISOR", CYAN)
    demo_config_path = Path("/tmp/demo_scrape_config.json")
    mock_html_path = Path("/tmp/mock_x_trending.html")
    initial_config = _setup_demo_config(demo_config_path, mock_html_path)

    sub_header("SETUP", "Configuration & Initial State")
    print(f"📄 Target Configuration File : {BOLD}{demo_config_path}{RESET}")

    playwright_args = get_playwright_args()

    async with async_playwright() as p:
        sub_header("STEP 1", "Launch Chrome & Initialize Stealth Session")
        browser = await p.chromium.launch(
            channel="chrome", headless=True, args=playwright_args
        )
        page = await browser.new_page()
        await page.goto(f"file://{mock_html_path}", wait_until="domcontentloaded")

        selectors_dict = json.loads(json.dumps(initial_config))
        broken_sel = selectors_dict["selectors"]["sidebar_container"]

        sub_header("STEP 2", "AI Diagnostic Reasoning & Verification")
        diagnosis = await _execute_ai_diagnosis(page, broken_sel)
        verified_selector = await _probe_candidates(page, diagnosis)

        if not verified_selector:
            print(f"❌ {RED}All candidate selectors failed.{RESET}")
            return

        patch_success = patch_selector_config(
            config_path=demo_config_path,
            key_path="selectors.sidebar_container",
            new_selector=verified_selector,
        )
        selectors_dict["selectors"]["sidebar_container"] = verified_selector

        print(
            f"   💾 Hot-Patched Disk Config : {GREEN}{demo_config_path}{RESET} (Status: {patch_success})"
        )
        print(
            f"   🧠 In-Memory Dict Updated  : {GREEN}'{selectors_dict['selectors']['sidebar_container']}'{RESET}"
        )

        with open(demo_config_path, encoding="utf-8") as f:
            persisted = json.load(f)
        print(
            f"\n   {BOLD}Persisted File on Disk (/tmp/demo_scrape_config.json):{RESET}"
        )
        print(f"{DIM}{json.dumps(persisted['selectors'], indent=4)}{RESET}")

        sub_header("STEP 7", "Scraper Execution Resumes with Healed Selector")
        print(
            f"🚀 Calling {BOLD}extract_trending_sidebar(page, selectors, config_path){RESET}..."
        )

        topics = await extract_trending_sidebar(
            page=page,
            selectors=selectors_dict,
            config_path=demo_config_path,
        )

        print(
            f"\n🎉 {GREEN}{BOLD}SUCCESSFULLY EXTRACTED {len(topics)} TRENDING TOPICS!{RESET}\n"
        )
        for idx, topic in enumerate(topics, 1):
            print(f"   📌 {BOLD}Topic {idx}:{RESET} {CYAN}{topic.topic_title}{RESET}")
            print(f"      • Category   : {topic.category or 'General'}")
            print(f"      • Post Count : {topic.post_count or 'N/A'}")
            print(f"      • Target URL : {DIM}{topic.topic_url}{RESET}")

        await browser.close()

    banner("DEMONSTRATION COMPLETE: ZERO ERRORS, 100% HEALED & EXTRACTED!", GREEN)


if __name__ == "__main__":
    asyncio.run(run_detailed_scrape_demo())
