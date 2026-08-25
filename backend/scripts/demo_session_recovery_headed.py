"""Live Headed Visual Demonstration for SessionRecoveryGraph (Tier 1 Shared Adaptive Subgraph).

Launches a real Chromium browser window, displays an X-style modal overlay,
and demonstrates SessionRecoveryGraph diagnosing and dismissing it live on screen.

Usage:
    cd backend && uv run python scripts/demo_session_recovery_headed.py
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

# Add backend directory to sys.path
sys.path.append(str(Path(__file__).parent.parent))

from rebrowser_playwright.async_api import async_playwright

from app.services.agentic import recover_page_session
from app.services.browser.core import get_playwright_args

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

MODAL_HTML = """
<!DOCTYPE html>
<html>
<head>
  <title>Home / X</title>
  <style>
    body { background-color: #000; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 20px; }
    .feed { max-width: 600px; margin: 0 auto; }
    .tweet { border-bottom: 1px solid #2f3336; padding: 12px 0; }
    /* Blocking modal overlay */
    .overlay-backdrop {
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(91, 112, 131, 0.4); display: flex; align-items: center; justify-content: center; z-index: 1000;
    }
    .modal-box {
      background: #000; border: 1px solid #2f3336; border-radius: 16px; padding: 32px; max-width: 400px; text-align: center;
      box-shadow: 0 0 20px rgba(255,255,255,0.1);
    }
    .btn-not-now {
      background: #eff3f4; color: #0f1419; border: none; padding: 12px 24px; border-radius: 9999px; font-weight: bold; cursor: pointer; margin-top: 16px; font-size: 15px;
    }
    .btn-not-now:hover { background: #d7dbdc; }
  </style>
</head>
<body>
  <div class="feed">
    <h2>X Timeline</h2>
    <div class="tweet">🤖 LinkX Agentic Supervisor initialized.</div>
    <div class="tweet">✨ Tier 1 Shared Adaptive Subgraphs active.</div>
  </div>

  <!-- Simulated X.com notification prompt modal -->
  <div class="overlay-backdrop" id="modalOverlay" data-testid="sheetDialog">
    <div class="modal-box">
      <h3>Turn on notifications?</h3>
      <p style="color: #71767b; font-size: 14px;">Don't miss out on trending topics and agentic workflow updates.</p>
      <button class="btn-not-now" role="button" onclick="document.getElementById('modalOverlay').style.display='none'">
        Not now
      </button>
    </div>
  </div>
</body>
</html>
"""


async def main() -> None:
    print("=" * 70)
    print("🖥️  HEADED DEMO: SessionRecoveryGraph Overlay Dismissal")
    print("=" * 70)

    playwright_args = get_playwright_args()
    # Remove headless flag if present in args
    args = [a for a in playwright_args if not a.startswith("--headless")]

    modal_path = Path("/tmp/demo_x_modal.html")
    modal_path.write_text(MODAL_HTML, encoding="utf-8")

    async with async_playwright() as p:
        print("\n1. Launching Chrome in HEADED mode (visible window)...")
        browser = await p.chromium.launch(
            channel="chrome",
            headless=False,
            args=args,
        )

        context = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await context.new_page()

        print("2. Loading page with active modal overlay dialog...")
        await page.goto(f"file://{modal_path}", wait_until="domcontentloaded")
        print(
            "   👉 Look at the browser window: The 'Turn on notifications?' modal is blocking the timeline."
        )

        print("\n3. Waiting 2.5 seconds before invoking SessionRecoveryGraph...")
        await asyncio.sleep(2.5)

        print("\n4. Running recover_page_session(page=page)...")
        report = await recover_page_session(page=page, timeout_ms=5000)

        print("\n" + "=" * 70)
        print(f"🎯 RECOVERY RESULT (Status: {report.status.upper()})")
        print("=" * 70)
        print(f"Recovered:       {'✅ YES' if report.recovered else '❌ NO'}")
        print(f"Page State:      {report.page_state}")
        print(f"Overlay Type:    {report.overlay_type}")
        print(f"Recovery Action: {report.recovery_action}")
        print(f"Error:           {report.error}")
        print("=" * 70)

        print(
            "\n5. Modal dismissed! Keeping browser open for 3 seconds so you can see the clean timeline..."
        )
        await asyncio.sleep(3.0)

        await browser.close()
        print("✅ Demo completed successfully!\n")


if __name__ == "__main__":
    asyncio.run(main())
