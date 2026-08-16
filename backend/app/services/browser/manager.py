"""High-level browser session manager."""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

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


def _read_session_meta_file(session_dir: Path) -> dict[str, Any]:
    meta_path = session_dir / "session_meta.json"
    if not meta_path.exists():
        return {
            "is_premium": False,
            "max_character_limit": 280,
            "username": None,
            "display_name": None,
        }
    try:
        with open(meta_path, encoding="utf-8") as f:
            data = json.load(f)
            return {
                "is_premium": bool(data.get("is_premium", False)),
                "max_character_limit": int(data.get("max_character_limit", 280)),
                "username": data.get("username"),
                "display_name": data.get("display_name"),
            }
    except Exception:
        return {
            "is_premium": False,
            "max_character_limit": 280,
            "username": None,
            "display_name": None,
        }


def _write_session_meta_file(session_dir: Path, meta: dict[str, Any]) -> None:
    meta_path = session_dir / "session_meta.json"
    try:
        session_dir.mkdir(parents=True, exist_ok=True)
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
    except Exception as exc:
        logger.warning("Could not write session_meta.json: %s", exc)


async def _inspect_x_profile(page: Any) -> tuple[bool, str | None, str | None]:
    is_premium = False
    username: str | None = None
    display_name: str | None = None

    try:
        verified_elem = await page.query_selector(
            "svg[data-testid='icon-verified'], [data-testid='SideNav_AccountSwitcher_Button'] svg[data-testid='icon-verified']"
        )
        if verified_elem and await verified_elem.is_visible():
            is_premium = True

        profile_link = await page.query_selector(
            "a[data-testid='AppTabBar_Profile_Link']"
        )
        if profile_link:
            href = await profile_link.get_attribute("href")
            if href and href.startswith("/"):
                username = href.strip("/")

        name_elem = await page.query_selector(
            "[data-testid='SideNav_AccountSwitcher_Button'] [dir='ltr']"
        )
        if name_elem:
            display_name = await name_elem.inner_text()
    except Exception as exc:
        logger.debug("Could not inspect X profile details: %s", exc)

    return is_premium, username, display_name


def _format_verification_message(
    *, is_logged_in: bool, is_premium: bool, username: str | None
) -> str:
    if not is_logged_in:
        return "Session cookies expired or login required."
    if is_premium:
        return f"Session authenticated! Verified X Premium account ({username or 'user'}) - 25,000 chars limit."
    return "Session authenticated! Home feed verified."


def _build_verification_payload(
    *,
    is_logged_in: bool,
    is_premium: bool,
    username: str | None,
    display_name: str | None,
    url: str | None,
) -> dict[str, Any]:
    max_limit = 25000 if is_premium else 280
    return {
        "connected": True,
        "authenticated": is_logged_in,
        "is_premium": is_premium,
        "max_character_limit": max_limit,
        "username": username,
        "display_name": display_name,
        "url": url,
        "message": _format_verification_message(
            is_logged_in=is_logged_in,
            is_premium=is_premium,
            username=username,
        ),
    }


def _build_unauthenticated_response(
    *, session_dir: Path, message: str
) -> dict[str, Any]:
    cached = _read_session_meta_file(session_dir)
    return {
        "connected": True,
        "authenticated": False,
        "is_premium": cached.get("is_premium", False),
        "max_character_limit": cached.get("max_character_limit", 280),
        "username": cached.get("username"),
        "display_name": cached.get("display_name"),
        "message": message,
    }


class BrowserManager:
    """Manages browser sessions and Playwright contexts for automation."""

    def __init__(
        self,
        brand_id: str | None = None,
        *,
        user_id: str | None = None,
    ) -> None:
        resolved_id = user_id or brand_id or "default"
        self.user_id = resolved_id
        self.brand_id = resolved_id

    def get_session_dir_path(self, platform_name: str) -> Path:
        """Return the directory path for this user and platform."""
        return get_session_dir(self.brand_id, platform_name)

    def read_session_metadata(self, platform_name: str = "x") -> dict[str, Any]:
        """Read cached session metadata from disk."""
        session_dir = self.get_session_dir_path(platform_name)
        return _read_session_meta_file(session_dir)

    def session_exists(self, platform_name: str) -> bool:
        """Check if a persistent session directory exists and contains cookies."""
        if platform_name not in PLATFORMS:
            raise ValueError(f"Unknown platform: {platform_name}")
        session_dir = self.get_session_dir_path(platform_name)
        if not session_dir.exists():
            return False

        # Playwright creates the folder and skeletal files as soon as it launches,
        # so checking if the directory is empty is insufficient. We check for cookies.
        cookies_path = session_dir / "Default" / "Cookies"
        network_cookies_path = session_dir / "Default" / "Network" / "Cookies"
        return cookies_path.exists() or network_cookies_path.exists()

    async def verify_session(self, platform_name: str = "x") -> dict[str, Any]:
        """Verify that the browser session is valid and authenticated."""
        session_dir = self.get_session_dir_path(platform_name)
        if not self.session_exists(platform_name):
            return {
                "connected": False,
                "authenticated": False,
                "is_premium": False,
                "max_character_limit": 280,
                "username": None,
                "display_name": None,
                "message": "No cookie session found. Please launch headed browser login.",
            }

        config = PLATFORMS.get(platform_name)
        if not config:
            raise ValueError(f"Unknown platform: {platform_name}")

        try:
            return await self._verify_live_session(
                platform_name=platform_name,
                config=config,
                session_dir=session_dir,
            )
        except Exception as e:
            return _build_unauthenticated_response(
                session_dir=session_dir,
                message=f"Verification error: {e}",
            )

    async def _verify_live_session(
        self,
        *,
        platform_name: str,
        config: Any,
        session_dir: Path,
    ) -> dict[str, Any]:
        async with self.get_context(platform_name, headless=True) as context:
            page = context.pages[0] if context.pages else await context.new_page()
            for p in context.pages[1:]:
                await p.close()
            await page.goto(config.url, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(2)

            element = await page.query_selector(config.sentinel_selector)
            is_logged_in = bool(element and await element.is_visible())

            is_premium, username, display_name = (
                await _inspect_x_profile(page)
                if (is_logged_in and platform_name == "x")
                else (False, None, None)
            )

            if is_logged_in:
                _write_session_meta_file(
                    session_dir,
                    {
                        "is_premium": is_premium,
                        "max_character_limit": 25000 if is_premium else 280,
                        "username": username,
                        "display_name": display_name,
                    },
                )

            return _build_verification_payload(
                is_logged_in=is_logged_in,
                is_premium=is_premium,
                username=username,
                display_name=display_name,
                url=page.url,
            )

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
