"""LinkedIn platform configuration."""

from .base import PlatformConfig

LinkedInConfig = PlatformConfig(
    name="LinkedIn",
    url="https://www.linkedin.com/feed/",
    login_url="https://www.linkedin.com/login",
    sentinel_selector="div[data-test-id='nav-current-user'], .global-nav__me",
    posts_selector=".feed-shared-update-v2__description",
)
