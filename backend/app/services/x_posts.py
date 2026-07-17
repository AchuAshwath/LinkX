import asyncio
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from rebrowser_playwright.async_api import Error as PlaywrightError
from rebrowser_playwright.async_api import TimeoutError as PlaywrightTimeoutError

from app.services.browser.actions import (
    EvasionMouse,
    PostButtonDisabledError,
    random_delay,
)
from app.services.browser.manager import BrowserManager

logger = logging.getLogger(__name__)


class XPostError(HTTPException):
    """Specialized error for X.com post operations."""

    def __init__(
        self,
        *,
        status_code: int,
        detail: str,
        code: str = "x_publish_failed",
        retryable: bool = False,
        details: dict[str, Any] | None = None,
        trace_id: str | None = None,
    ) -> None:
        self.code = code
        self.retryable = retryable
        self.details = details or {}
        self.trace_id = trace_id or str(uuid.uuid4())
        super().__init__(status_code=status_code, detail=detail)


class XPostClient:
    """Client for posting to X.com using browser automation."""

    def __init__(self) -> None:
        self.selectors_path = (
            Path(__file__).parent / "browser" / "selectors" / "x_selectors.json"
        )
        if not self.selectors_path.exists():
            raise RuntimeError(f"Missing X selectors at {self.selectors_path}")

        with open(self.selectors_path) as f:
            self.selectors = json.load(f)

    async def create_text_post(
        self,
        *,
        persona_id: str,
        content: str,
    ) -> str:
        """Create a text-only post on X.com using Playwright.

        Returns the X.com tweet ID (rest_id).
        """
        if len(content) > 280:
            raise XPostError(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Post content exceeds X.com's 280 character limit.",
                code="x_content_too_long",
                retryable=False,
                details={"platform": "x", "length": len(content)},
            )

        manager = BrowserManager(brand_id=persona_id)

        if not manager.session_exists("x"):
            raise XPostError(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="X session not found. Please connect X account.",
                code="x_not_connected",
                retryable=False,
                details={"platform": "x"},
            )

        post_input_selector = self.selectors["compose"]["post_input"]
        post_button_selector = self.selectors["compose"]["post_button"]

        try:
            async with manager.get_context(
                "x", headless=(os.environ.get("PLAYWRIGHT_HEADLESS", "1") == "1")
            ) as context:
                page = context.pages[0] if context.pages else await context.new_page()
                mouse = EvasionMouse(page)
                asyncio.create_task(mouse.start_idle())

                logger.info("Navigating to https://x.com/home")
                await page.goto("https://x.com/home", wait_until="domcontentloaded")

                # Sentinel Check: Wait for the URL to stabilize to either /home or a checkpoint
                try:
                    await page.wait_for_url(
                        lambda url: "home" in url
                        or "checkpoint" in url
                        or "login" in url,
                        timeout=10000,
                    )
                except PlaywrightTimeoutError:
                    pass  # If it times out, we'll just check current_url next anyway

                current_url = page.url
                if "/home" not in current_url:
                    await mouse.stop_idle()
                    body = await page.inner_text("body")
                    if (
                        "Help us keep Twitter safe" in body
                        or "Confirm your phone number" in body
                        or "checkpoint" in current_url
                    ):
                        raise XPostError(
                            status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="X session flagged by security checkpoint. Please re-login.",
                            code="x_session_flagged",
                            retryable=False,
                            details={"platform": "x", "url": current_url},
                        )
                    raise XPostError(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="X session expired or invalid. Please re-login.",
                        code="x_session_expired",
                        retryable=False,
                        details={"platform": "x", "url": current_url},
                    )

                logger.info(
                    "Sentinel check passed (URL routing confirmed), proceeding with post."
                )
                await random_delay(min_sec=2.0, max_sec=4.0)

                logger.info(
                    f"Targeting post input box using selector: {post_input_selector}"
                )
                await mouse.human_click(selector=post_input_selector)

                logger.info("Typing draft post")
                await mouse.human_type(
                    selector=post_input_selector, text=content, wpm=90.0
                )

                await random_delay(min_sec=1.0, max_sec=2.0)

                logger.info(
                    "Setting up network interceptor for CreateTweet GraphQL endpoint..."
                )
                try:
                    async with page.expect_response(
                        lambda response: "graphql" in response.url
                        and "CreateTweet" in response.url
                        and response.request.method == "POST",
                        timeout=15000,
                    ) as response_info:
                        await mouse.human_click(selector=post_button_selector)

                    response = await response_info.value

                    if response.status != 200:
                        raise XPostError(
                            status_code=status.HTTP_502_BAD_GATEWAY,
                            detail=f"X.com returned HTTP {response.status}",
                            code="x_network_error",
                            retryable=True,
                            details={"platform": "x"},
                        )

                    response_json = await response.json()
                    if "errors" in response_json:
                        logger.error(
                            f"GraphQL returned errors: {json.dumps(response_json['errors'])}"
                        )
                        raise XPostError(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail="GraphQL application-level error during post.",
                            code="x_graphql_error",
                            retryable=False,
                            details={
                                "platform": "x",
                                "errors": response_json["errors"],
                            },
                        )

                    rest_id = None
                    try:
                        rest_id = response_json["data"]["create_tweet"][
                            "tweet_results"
                        ]["result"]["rest_id"]
                    except (KeyError, TypeError):
                        pass

                    if not rest_id:
                        raise XPostError(
                            status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="X.com did not return a tweet ID.",
                            code="x_missing_post_id",
                            retryable=True,
                            details={"platform": "x"},
                        )

                    await mouse.stop_idle()
                    logger.info(f"✅ SUCCESSFULLY POSTED TO X (rest_id: {rest_id})")
                    return str(rest_id)

                except PostButtonDisabledError:
                    await mouse.stop_idle()
                    raise XPostError(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="The Post button remained disabled. Content may be too long or invalid.",
                        code="x_button_disabled",
                        retryable=False,
                        details={"platform": "x"},
                    )
                except PlaywrightTimeoutError:
                    await mouse.stop_idle()
                    raise XPostError(
                        status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                        detail="Timeout waiting for CreateTweet network response.",
                        code="x_timeout",
                        retryable=True,
                        details={"platform": "x"},
                    )

        except XPostError:
            raise
        except PlaywrightError as e:
            if "closed" in str(e).lower():
                raise XPostError(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Browser window was closed manually.",
                    code="x_browser_closed",
                    retryable=False,
                    details={"platform": "x"},
                )
            raise XPostError(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Browser automation error: {e}",
                code="x_automation_error",
                retryable=True,
                details={"platform": "x"},
            )
        except Exception as e:
            raise XPostError(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Unexpected error: {e}",
                code="x_internal_error",
                retryable=False,
                details={"platform": "x"},
            )
