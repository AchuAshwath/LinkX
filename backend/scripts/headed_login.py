"""Launch a plain Chrome window for manual login & session persistence.

This script is now a thin wrapper around the `backend.app.services.browser` library.
"""

from __future__ import annotations

import argparse
import logging
import sys

from app.services.browser import PLATFORMS, BrowserManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("headed_login")


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

    manager = BrowserManager(brand_id=args.brand_id)
    try:
        manager.start_login_subprocess(platform_name=args.platform, force=args.force)
    except Exception as e:
        logger.error(str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
