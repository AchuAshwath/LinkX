"""Browser automation library for LinkX.

This package provides a modular, cross-platform interface for launching
headed login sessions (to bypass bot detection) and headless automation
contexts via Playwright.
"""

from .actions import EvasionMouse, human_navigation, random_delay
from .manager import BrowserManager
from .platforms import PLATFORMS, LinkedInConfig, PlatformConfig, XConfig

__all__ = [
    "BrowserManager",
    "PlatformConfig",
    "XConfig",
    "LinkedInConfig",
    "PLATFORMS",
    "random_delay",
    "EvasionMouse",
    "human_navigation",
]
