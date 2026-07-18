"""High-level browser session manager."""

from __future__ import annotations

import logging
import subprocess
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from rebrowser_playwright.async_api import BrowserContext, async_playwright

from .core import (
    find_chrome,
    get_playwright_args,
    get_quit_instruction,
    get_session_dir,
    is_chrome_running,
)
from .platforms import PLATFORMS

logger = logging.getLogger(__name__)


class BrowserManager:
    """Manages browser sessions and Playwright contexts for automation."""

    def __init__(self, brand_id: str = "default"):
        self.brand_id = brand_id

    def session_exists(self, platform_name: str) -> bool:
        """Check if a persistent session directory exists and contains cookies."""
        if platform_name not in PLATFORMS:
            raise ValueError(f"Unknown platform: {platform_name}")
        session_dir = get_session_dir(self.brand_id, platform_name)
        if not session_dir.exists():
            return False

        # Playwright creates the folder and skeletal files as soon as it launches,
        # so checking if the directory is empty is insufficient. We check for cookies.
        cookies_path = session_dir / "Default" / "Cookies"
        network_cookies_path = session_dir / "Default" / "Network" / "Cookies"
        return cookies_path.exists() or network_cookies_path.exists()

    def start_login_subprocess(self, platform_name: str, force: bool = False) -> None:
        """Launch a vanilla Chrome window for manual user login.

        Args:
            platform_name: 'x' or 'linkedin'
            force: Skip the singleton check (use with caution).

        Raises:
            RuntimeError: If Chrome is not found or is already running.
            ValueError: If platform is invalid.
        """
        if platform_name not in PLATFORMS:
            raise ValueError(f"Unknown platform: {platform_name}")

        config = PLATFORMS[platform_name]
        session_dir = get_session_dir(self.brand_id, platform_name)
        session_dir.mkdir(parents=True, exist_ok=True)

        chrome = find_chrome()
        if chrome is None:
            raise RuntimeError(
                "Google Chrome was not found on this system. "
                "Please install Chrome or set CHROME_PATH in your environment."
            )

        if not force and is_chrome_running():
            quit_hint = get_quit_instruction()
            msg = (
                "Google Chrome is already running!\n"
                "Chrome may merge the new window into the existing instance "
                "and IGNORE --user-data-dir, saving cookies to your personal "
                "profile instead of our session directory.\n"
                f"Please {quit_hint} first."
            )
            raise RuntimeError(msg)

        logger.info("Chrome binary : %s", chrome)
        logger.info("Session dir   : %s", session_dir)
        logger.info("Opening %s (%s) ...", config.name, config.login_url)

        cmd: list[str] = [
            chrome,
            f"--user-data-dir={session_dir}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-default-apps",
            # We must pass the same password-store flags as Playwright uses
            # to ensure the SQLite DB is encrypted with the same key.
            *get_playwright_args(),
            config.login_url,
        ]

        quit_instruction = get_quit_instruction()
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

        logger.info("Chrome closed. Session saved to: %s", session_dir)

    @asynccontextmanager
    async def get_context(
        self, platform_name: str, headless: bool = True
    ) -> AsyncGenerator[BrowserContext, None]:
        """Yield a configured Playwright BrowserContext for the given platform.

        Args:
            platform_name: 'x' or 'linkedin'
            headless: Whether to run headlessly.

        Raises:
            FileNotFoundError: If the session directory does not exist.
            ValueError: If platform is invalid.
        """
        if platform_name not in PLATFORMS:
            raise ValueError(f"Unknown platform: {platform_name}")

        session_dir = get_session_dir(self.brand_id, platform_name)
        if not session_dir.exists():
            raise FileNotFoundError(
                f"Session directory not found at: {session_dir}. "
                f"Please run headed_login first for platform '{platform_name}'."
            )

        playwright_args = get_playwright_args()

        async with async_playwright() as p:
            context = None
            try:
                logger.debug("Attempting to launch with channel='chrome'...")
                context = await p.chromium.launch_persistent_context(
                    user_data_dir=str(session_dir),
                    headless=headless,
                    channel="chrome",
                    viewport={"width": 1280, "height": 800},
                    ignore_default_args=["--enable-automation"],
                    args=playwright_args,
                )
            except Exception as e:
                logger.warning(
                    "Could not launch with channel='chrome', falling back "
                    "to bundled Chromium. Error: %s",
                    e,
                    exc_info=True,
                )
                context = await p.chromium.launch_persistent_context(
                    user_data_dir=str(session_dir),
                    headless=headless,
                    viewport={"width": 1280, "height": 800},
                    ignore_default_args=["--enable-automation"],
                    args=playwright_args,
                )

            try:
                yield context
            finally:
                await context.close()
