"""X (Twitter) platform configuration."""

from .base import PlatformConfig

XConfig = PlatformConfig(
    name="X (Twitter)",
    url="https://x.com/",
    login_url="https://x.com/",
    sentinel_selector="[data-testid='AppTabBar_Home_Link'], [data-testid='SideNav_AccountSwipe_Button']",
    posts_selector="[data-testid='tweetText']",
)
