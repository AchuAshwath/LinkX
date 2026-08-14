"""Low-level OS and browser utilities for headless automation."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
from pathlib import Path

from app.core.config import settings


def get_sessions_dir() -> Path:
    """Return the root directory for storing browser sessions."""
    return settings.SESSIONS_DIR


def get_session_dir(brand_id: str | None = None, platform_name: str = "x") -> Path:
    """Return the user-data-dir for a specific platform.

    LinkX uses a single, dedicated session path per platform on the host machine:
    `settings.SESSIONS_DIR / platform_name` (or `sessions/{brand_id}/{platform_name}`).
    """
    direct_path = settings.SESSIONS_DIR / platform_name
    if direct_path.exists():
        return direct_path
    if brand_id and (settings.SESSIONS_DIR / brand_id / platform_name).exists():
        return settings.SESSIONS_DIR / brand_id / platform_name
    default_path = settings.SESSIONS_DIR / "default" / platform_name
    if default_path.exists():
        return default_path
    return direct_path


def find_chrome() -> str | None:
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


def is_chrome_running() -> bool:
    """Return True if any Google Chrome process is currently running."""
    system = platform.system()
    try:
        if system == "Darwin":
            result = subprocess.run(
                ["pgrep", "-x", "Google Chrome"],
                capture_output=True,
                text=True,
                check=False,
            )
            return result.returncode == 0
        elif system == "Linux":
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


def get_quit_instruction() -> str:
    """Return the OS-appropriate instruction for quitting Chrome."""
    system = platform.system()
    if system == "Darwin":
        return "QUIT Chrome with Cmd+Q (not just close the window)"
    elif system == "Windows":
        return "QUIT Chrome with Alt+F4 or File → Exit"
    else:
        return "QUIT Chrome by closing all windows (Ctrl+Q or File → Quit)"


def get_playwright_args() -> list[str]:
    """Return OS-specific Chrome flags needed to decrypt the session cookies."""
    args = [
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--password-store=basic",
    ]
    if platform.system() == "Darwin":
        args.append("--use-mock-keychain")
    return args
