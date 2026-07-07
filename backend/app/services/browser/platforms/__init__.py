"""Registry for supported social media platforms."""

from .base import PlatformConfig
from .linkedin import LinkedInConfig
from .x import XConfig

PLATFORMS: dict[str, PlatformConfig] = {
    "x": XConfig,
    "linkedin": LinkedInConfig,
}

__all__ = ["PLATFORMS", "PlatformConfig", "XConfig", "LinkedInConfig"]
