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

IMPORTANT — Chrome singleton behaviour (macOS):
    On macOS, if Google Chrome is already running, launching a second instance
    with a different ``--user-data-dir`` is silently merged into the existing
    process.  The custom profile directory is **ignored** and cookies go to your
    personal profile instead.  This script detects that situation and asks you
    to quit Chrome first.

IMPORTANT — Cookie encryption:
    Chrome encrypts its cookie database.  The encryption backend differs per OS:
      macOS  → Keychain  (bypassed with --use-mock-keychain --password-store=basic)
      Linux  → GNOME Keyring / KWallet  (bypassed with --password-store=basic)
      Windows → DPAPI  (bypassed with --password-store=basic)

    We always pass --password-store=basic so that the Playwright automation
    context (which is locked out of OS keychains by the debugger attachment) can
    decrypt the same cookies that this plain subprocess wrote.
"""

from __future__ import annotations

import argparse
import logging
import os
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
        # Cover both system-wide installs and user-level installs (no admin rights)
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        program_files = os.environ.get("PROGRAMFILES", r"C:\Program Files")
        program_files_x86 = os.environ.get(
            "PROGRAMFILES(X86)", r"C:\Program Files (x86)"
        )
        candidates = [
            str(Path(local_app_data) / r"Google\Chrome\Application\chrome.exe"),
            str(Path(program_files) / r"Google\Chrome\Application\chrome.exe"),
            str(Path(program_files_x86) / r"Google\Chrome\Application\chrome.exe"),
        ]

    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
        if Path(candidate).is_file():
            return candidate
    return None


def _chrome_is_running() -> bool:
    """Return True if any Google Chrome process is currently running."""
    system = platform.system()
    try:
        if system == "Darwin":
            result = subprocess.run(
                ["pgrep", "-x", "Google Chrome"],  # -x = exact process name match
                capture_output=True,
                text=True,
                check=False,
            )
            return result.returncode == 0
        elif system == "Linux":
            # Use -x to match only the exact process name "chrome" or
            # "google-chrome", not anything that merely contains "chrome"
            # (e.g. "chromium", VS Code extensions, etc.)
            for name in ("chrome", "google-chrome", "google-chrome-stable"):
                result = subprocess.run(
                    ["pgrep", "-x", name],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if result.returncode == 0:
                    return True
            return False
        elif system == "Windows":
            result = subprocess.run(
                ["tasklist", "/FI", "IMAGENAME eq chrome.exe"],
                capture_output=True,
                text=True,
                check=False,
            )
            return "chrome.exe" in result.stdout.lower()
    except FileNotFoundError:
        pass
    return False


def _quit_instruction() -> str:
    """Return the OS-appropriate instruction for quitting Chrome."""
    system = platform.system()
    if system == "Darwin":
        return "QUIT Chrome with Cmd+Q (not just close the window)"
    elif system == "Windows":
        return "QUIT Chrome with Alt+F4 or File → Exit"
    else:
        return "QUIT Chrome by closing all windows (Ctrl+Q or File → Quit)"


def _chrome_args_for_os() -> list[str]:
    """Return OS-specific Chrome flags required for keychain bypass."""
    # --password-store=basic is required on all platforms:
    #   macOS   → skips Keychain  (also needs --use-mock-keychain)
    #   Linux   → skips GNOME Keyring / KWallet
    #   Windows → skips DPAPI
    # Without this, Playwright (running under a debugger/CDP) cannot decrypt
    # the cookies that this subprocess wrote.
    args = ["--password-store=basic"]
    if platform.system() == "Darwin":
        # macOS additionally needs this flag to fully bypass Keychain
        args.append("--use-mock-keychain")
    return args


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
    parser.add_argument(
        "--force",
        action="store_true",
        help="Skip the Chrome-is-running check (use at your own risk)",
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

    # ── Guard: Chrome singleton (critical on macOS, good practice everywhere) ──
    if not args.force and _chrome_is_running():
        system = platform.system()
        quit_hint = (
            "Cmd+Q"
            if system == "Darwin"
            else "Alt+F4"
            if system == "Windows"
            else "Ctrl+Q / File → Quit"
        )
        logger.error("=" * 60)
        logger.error("Google Chrome is already running!")
        logger.error("")
        logger.error("Chrome may merge the new window into the existing instance")
        logger.error("and IGNORE --user-data-dir, saving cookies to your personal")
        logger.error("profile instead of our session directory.")
        logger.error("")
        logger.error(
            "Please QUIT Chrome completely (%s) first, then re-run this script.",
            quit_hint,
        )
        logger.error("")
        logger.error("  (or pass --force to skip this check at your own risk)")
        logger.error("=" * 60)
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
        *_chrome_args_for_os(),
        config["url"],
    ]

    quit_instruction = _quit_instruction()
    logger.info("=" * 60)
    logger.info("ACTION REQUIRED:")
    logger.info("  1. Log in & complete any 2FA in the Chrome window.")
    logger.info("  2. Once you see your feed / dashboard, wait ~10 seconds.")
    logger.info("  3. %s.", quit_instruction)
    logger.info("  The session will be saved automatically.")
    logger.info("=" * 60)

    try:
        subprocess.run(cmd, check=False)
    except KeyboardInterrupt:
        logger.info("Interrupted — session data saved so far is still usable.")

    logger.info("Chrome closed.  Session saved to: %s", session_dir)


if __name__ == "__main__":
    main()
