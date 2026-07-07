"""Launch a plain Chrome window for manual login & session persistence.

This script opens a **vanilla** Google Chrome process (no Playwright, no CDP,
no automation hooks) pointed at a dedicated ``--user-data-dir``.  The user logs
in manually, then closes Chrome.  The saved profile (cookies, localStorage,
IndexedDB) can later be loaded by ``rebrowser-playwright`` for automated
scraping and posting — at that point the session is already authenticated so the
login page is never hit again.

Why not Playwright for login?
    X (Twitter) detects the Chrome DevTools Protocol connection that Playwright
    opens and blocks login with "Sorry, you are not allowed to log in at this
    time".  A plain ``subprocess`` Chrome has zero automation surface.
"""

from __future__ import annotations

import argparse
import logging
import platform
import shutil
import subprocess
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("headed_login")

PLATFORMS = {
    "linkedin": {
        "url": "https://www.linkedin.com/login",
        "name": "LinkedIn",
    },
    "x": {
        "url": "https://x.com",
        "name": "X (Twitter)",
    },
}


def _find_chrome() -> str | None:
    """Return the path to Google Chrome, or ``None`` if not found."""
    system = platform.system()
    candidates: list[str] = []

    if system == "Darwin":
        candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            str(
                Path.home()
                / "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            ),
        ]
    elif system == "Linux":
        candidates = [
            "google-chrome",
            "google-chrome-stable",
            "chromium-browser",
            "chromium",
        ]
    elif system == "Windows":
        candidates = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ]

    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
        if Path(candidate).is_file():
            return candidate
    return None


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Open a plain Chrome window for manual login.  "
            "The session profile is saved for later automation."
        ),
    )
    parser.add_argument(
        "--platform",
        choices=list(PLATFORMS.keys()),
        required=True,
        help="The platform to log into (linkedin or x)",
    )
    parser.add_argument(
        "--brand-id",
        default="default",
        help="Brand / persona identifier (default: 'default')",
    )
    args = parser.parse_args()

    config = PLATFORMS[args.platform]

    # Session directory lives next to the backend package
    script_dir = Path(__file__).resolve().parent
    sessions_root = script_dir.parent / "sessions"
    session_dir = sessions_root / args.brand_id / args.platform
    session_dir.mkdir(parents=True, exist_ok=True)

    chrome = _find_chrome()
    if chrome is None:
        logger.error(
            "Google Chrome was not found on this system.  "
            "Please install Chrome or set CHROME_PATH in your environment."
        )
        sys.exit(1)

    logger.info("Chrome binary : %s", chrome)
    logger.info("Session dir   : %s", session_dir)
    logger.info("Opening %s (%s) ...", config["name"], config["url"])

    cmd: list[str] = [
        chrome,
        f"--user-data-dir={session_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-default-apps",
        config["url"],
    ]

    logger.info("=" * 60)
    logger.info("ACTION REQUIRED:")
    logger.info("  1. Log in & complete any 2FA in the Chrome window.")
    logger.info("  2. Once you see your feed / dashboard, CLOSE Chrome.")
    logger.info("  The session will be saved automatically.")
    logger.info("=" * 60)

    try:
        subprocess.run(cmd, check=False)
    except KeyboardInterrupt:
        logger.info("Interrupted — session data saved so far is still usable.")

    logger.info("Chrome closed.  Session saved to: %s", session_dir)


if __name__ == "__main__":
    main()
