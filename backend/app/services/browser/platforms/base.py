"""Base interface for platform configurations."""

from __future__ import annotations

import dataclasses


@dataclasses.dataclass
class PlatformConfig:
    """Configuration for a specific social media platform."""

    name: str
    url: str
    login_url: str
    sentinel_selector: str
    posts_selector: str
