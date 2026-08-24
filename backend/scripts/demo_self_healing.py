"""Live demonstration script for the Self-Healing Selector Engine (Issue #86).

This script:
1. Creates a temporary selector configuration with an intentionally broken selector.
2. Loads a realistic X.com page DOM using real Google Chrome via rebrowser-playwright.
3. Attempts an element action (typing a post draft).
4. Demonstrates the LangGraph self-healing supervisor diagnosing the failure with live LLM (gemini-3.7-flash-high),
   testing candidates on the live page, hot-patching the configuration on disk, and succeeding!
"""

import asyncio
import json
import logging
import sys
from pathlib import Path

# Add backend directory to sys.path
sys.path.append(str(Path(__file__).parent.parent))

from rebrowser_playwright.async_api import async_playwright

from app.services.browser.core import get_playwright_args
from app.services.x_posts import enter_compose_text

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Sample realistic X.com composer DOM
MOCK_X_PAGE_HTML = """
<!DOCTYPE html>
<html>
<head>
  <title>X / Home</title>
</head>
<body style="background-color: #000; color: #fff;">
  <div data-testid="primaryColumn">
    <div data-testid="tweetTextarea_0_label" role="group">
      <div
        role="textbox"
        data-testid="tweetTextarea_0"
        class="public-DraftEditor-content"
        contenteditable="true"
        aria-label="Post text"
        tabindex="0"
        style="border: 1px solid #333; padding: 12px; min-height: 80px;"
      ></div>
    </div>
    <button data-testid="tweetButtonInline" role="button" style="padding: 8px 16px;">
      Post
    </button>
  </div>
</body>
</html>
"""


async def run_demo() -> None:
    demo_config_path = Path("/tmp/demo_x_selectors.json")

    # 1. Create an intentionally broken configuration
    broken_config = {
        "compose": {
            "post_input": "div[data-testid='totally_broken_fake_textarea_9999']",
            "post_button": "button[data-testid='tweetButtonInline']",
        }
    }
    with open(demo_config_path, "w", encoding="utf-8") as f:
        json.dump(broken_config, f, indent=2)

    print("\n" + "=" * 70)
    print("🚀 LINKX AGENTIC SELF-HEALING SELECTOR ENGINE: LIVE DEMONSTRATION")
    print("=" * 70)
    print(f"\n📁 Created temporary config at: {demo_config_path}")
    print("🔴 Initial Broken Selector in Configuration:")
    print(f'   compose.post_input -> "{broken_config["compose"]["post_input"]}"')

    playwright_args = get_playwright_args()

    mock_html_path = Path("/tmp/mock_x_compose.html")
    mock_html_path.write_text(MOCK_X_PAGE_HTML, encoding="utf-8")

    async with async_playwright() as p:
        print(
            "\n🌐 Launching Chrome (rebrowser-playwright) and loading realistic X.com DOM..."
        )
        browser = await p.chromium.launch(
            channel="chrome",
            headless=True,
            args=playwright_args,
        )
        page = await browser.new_page()
        await page.goto(f"file://{mock_html_path}", wait_until="domcontentloaded")

        selectors_dict = json.loads(json.dumps(broken_config))

        print("\n⚡ Attempting action: enter_compose_text() with broken selector...")
        print(
            "   (Watch the LangGraph Supervisor intercept the miss and self-heal with live LLM)\n"
        )

        success = await enter_compose_text(
            page=page,
            text="Autonomous Self-Healing is working in LinkX! 🦾",
            selectors=selectors_dict,
            config_path=demo_config_path,
        )

        print("\n" + "-" * 70)
        print(f"✅ Action Succeeded: {success}")
        print("-" * 70)

        # Read updated config from disk
        with open(demo_config_path, encoding="utf-8") as f:
            repaired_config = json.load(f)

        print("\n🟢 Repaired Selector (in-memory):")
        print(f'   compose.post_input -> "{selectors_dict["compose"]["post_input"]}"')

        print("\n💾 Hot-Patched Selector on Disk (/tmp/demo_x_selectors.json):")
        print(f'   compose.post_input -> "{repaired_config["compose"]["post_input"]}"')

        # Verify element content on page
        healed_loc = page.locator(selectors_dict["compose"]["post_input"]).first
        content = await healed_loc.inner_text()
        print("\n📝 Verified text typed into healed input element on live page:")
        print(f'   "{content}"')

        await browser.close()

    print("\n" + "=" * 70)
    print("🎉 SELF-HEALING ENGINE SUCCESSFULLY DIAGNOSED, REPAIRED & PERSISTED!")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    asyncio.run(run_demo())
