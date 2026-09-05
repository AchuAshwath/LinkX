"""Tests for Perception Agentic Tools and SSRF Prevention."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.agentic.tools.perception_tools import (
    ALLOWED_TOPIC_DOMAINS,
    inspect_page_session_state,
    is_safe_topic_url,
    scrape_live_explore_trends,
    scrape_topic_timeline,
)


class TestSafeTopicUrlValidation:
    """Test URL safety validation and SSRF defenses for topic scraping."""

    @pytest.mark.parametrize(
        "valid_url",
        [
            "https://x.com/search?q=AI",
            "https://x.com/i/trending/1890000000000000001",
            "https://twitter.com/explore",
            "http://x.com/search?q=LinkX",
            "http://twitter.com/hashtag/tech",
            "https://mobile.x.com/home",
            "https://mobile.twitter.com/i/trends",
            "https://sub.x.com/timeline",
            "https://deep.sub.twitter.com/path",
            "https://x.com:443/topic",
            "http://x.com:80/topic",
            "  https://x.com/search?q=AI  ",
            "https://x.com/search?q=AI#fragment",
        ],
    )
    def test_allowed_urls(self, valid_url: str) -> None:
        assert is_safe_topic_url(url=valid_url) is True

    @pytest.mark.parametrize(
        "ssrf_ip_url",
        [
            "http://127.0.0.1",
            "http://127.0.0.1:8000",
            "http://localhost",
            "http://localhost:8000",
            "http://0.0.0.0:8000",
            "http://[::1]:8000",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.1/admin",
            "http://192.168.1.1/router",
            "http://172.16.0.1:5432",
        ],
    )
    def test_blocks_localhost_and_internal_ips(self, ssrf_ip_url: str) -> None:
        assert is_safe_topic_url(url=ssrf_ip_url) is False

    @pytest.mark.parametrize(
        "internal_host_url",
        [
            "http://redis:6379",
            "http://db:5432",
            "http://backend:8000",
            "http://mailcatcher:1080",
            "http://adminer:8080",
            "http://traefik:8090",
        ],
    )
    def test_blocks_internal_container_hosts(self, internal_host_url: str) -> None:
        assert is_safe_topic_url(url=internal_host_url) is False

    @pytest.mark.parametrize(
        "spoofed_domain_url",
        [
            "https://x.com.attacker.com",
            "https://twitter.com.evil.org",
            "https://notx.com",
            "https://fake-x.com",
            "https://fake-twitter.com",
            "https://evil.com/x.com",
            "https://evil.com#x.com",
            "https://evil.com?target=x.com",
            "https://x-com.com",
            "https://attacker.com",
        ],
    )
    def test_blocks_domain_spoofing(self, spoofed_domain_url: str) -> None:
        assert is_safe_topic_url(url=spoofed_domain_url) is False

    @pytest.mark.parametrize(
        "dangerous_scheme_url",
        [
            "file:///etc/passwd",
            "file:///proc/self/environ",
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "ftp://x.com/resource",
            "gopher://127.0.0.1:6379/_INFO",
            "ws://x.com/feed",
            "wss://x.com/feed",
        ],
    )
    def test_blocks_dangerous_schemes(self, dangerous_scheme_url: str) -> None:
        assert is_safe_topic_url(url=dangerous_scheme_url) is False

    @pytest.mark.parametrize(
        "non_standard_port_url",
        [
            "https://x.com:8080/search",
            "https://x.com:22",
            "https://x.com:3000",
            "https://twitter.com:8443",
        ],
    )
    def test_blocks_non_standard_ports(self, non_standard_port_url: str) -> None:
        assert is_safe_topic_url(url=non_standard_port_url) is False

    @pytest.mark.parametrize(
        "credentials_url",
        [
            "https://user:password@x.com/path",
            "https://admin@x.com/path",
            "https://x.com@attacker.com",
        ],
    )
    def test_blocks_userinfo_credentials(self, credentials_url: str) -> None:
        assert is_safe_topic_url(url=credentials_url) is False

    @pytest.mark.parametrize(
        "backslash_url",
        [
            "https://attacker.com\\.x.com",
            "https://x.com:443\\attacker.com",
            "https://x.com\\attacker.com",
            "https://x.com/\\attacker.com",
        ],
    )
    def test_blocks_backslash_and_parser_differentials(
        self, backslash_url: str
    ) -> None:
        assert is_safe_topic_url(url=backslash_url) is False

    @pytest.mark.parametrize(
        "control_char_url",
        [
            "https://x.com\n/search",
            "https://x.com\r/search",
            "https://x.com\t/search",
            "https://x.com\x00/search",
            "https://x.com /search",
        ],
    )
    def test_blocks_crlf_and_control_chars(self, control_char_url: str) -> None:
        assert is_safe_topic_url(url=control_char_url) is False

    @pytest.mark.parametrize(
        "invalid_port_url",
        [
            "https://x.com:abc",
            "https://x.com:999999999999999999999999999",
            "https://x.com:-1",
            "https://x.com:+80",
            "https://x.com:0",
        ],
    )
    def test_blocks_invalid_ports_without_crashing(self, invalid_port_url: str) -> None:
        assert is_safe_topic_url(url=invalid_port_url) is False

    @pytest.mark.parametrize(
        "malformed_label_url",
        [
            "https://.x.com",
            "https://..x.com",
            "https://...x.com",
            "https://-x.com",
            "https://x-.com",
            "https://sub.-x.com",
            "https://attacker.com%23.x.com",
            "https://attacker.com%3f.x.com",
            "https://attacker.com%2f.x.com",
        ],
    )
    def test_blocks_malformed_domain_labels(self, malformed_label_url: str) -> None:
        assert is_safe_topic_url(url=malformed_label_url) is False

    @pytest.mark.parametrize(
        "malformed_input",
        [
            "",
            "   ",
            "not-a-url",
            "://invalid",
            "http://",
            "https://",
            None,
        ],
    )
    def test_blocks_malformed_inputs(self, malformed_input: Any) -> None:
        assert is_safe_topic_url(url=malformed_input) is False

    def test_allowed_topic_domains_constant(self) -> None:
        assert "x.com" in ALLOWED_TOPIC_DOMAINS
        assert "twitter.com" in ALLOWED_TOPIC_DOMAINS


class TestScrapeTopicTimelineSSRF:
    """Test SSRF rejection and safe execution in scrape_topic_timeline."""

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "malicious_url",
        [
            "http://localhost:8000/api/v1/users",
            "http://127.0.0.1:8000/admin",
            "http://169.254.169.254/latest/meta-data/",
            "http://redis:6379",
            "file:///etc/passwd",
            "https://attacker.com/steal-session",
            "https://x.com.evil.com/fake-topic",
        ],
    )
    async def test_scrape_topic_timeline_blocks_ssrf(self, malicious_url: str) -> None:
        with patch(
            "app.services.agentic.tools.perception_tools.BrowserManager"
        ) as mock_bm_cls:
            res = await scrape_topic_timeline(
                topic_url=malicious_url,
                user_id="user-ssrf-victim",
                max_tweets=5,
            )

            assert res["success"] is False
            assert "Invalid or unauthorized topic URL" in res["error"]
            assert res["tweets"] == []
            assert res["grok_summary"] == ""
            # Critical: BrowserManager must never be instantiated for blocked URLs
            mock_bm_cls.assert_not_called()

    @pytest.mark.anyio
    async def test_scrape_topic_timeline_valid_url_no_session(self) -> None:
        with patch(
            "app.services.agentic.tools.perception_tools.BrowserManager"
        ) as mock_bm_cls:
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = False
            mock_bm_cls.return_value = mock_bm

            res = await scrape_topic_timeline(
                topic_url="https://x.com/search?q=AI",
                user_id="user-valid-1",
            )
            assert res["success"] is False
            assert "X session not connected" in res["error"]
            mock_bm.session_exists.assert_called_once_with("x")

    @pytest.mark.anyio
    async def test_scrape_topic_timeline_valid_url_success(self) -> None:
        mock_page = AsyncMock()
        mock_context = AsyncMock()
        mock_context.pages = [mock_page]

        mock_tweet = MagicMock()
        mock_tweet.author_handle = "@researcher"
        mock_tweet.text = "Deep learning breakthrough in 2026"
        mock_tweet.likes = 120
        mock_tweet.retweets = 35
        mock_tweet.replies = 10
        mock_tweet.views = 5000

        with (
            patch(
                "app.services.agentic.tools.perception_tools.BrowserManager"
            ) as mock_bm_cls,
            patch(
                "app.services.agentic.tools.perception_tools.extract_grok_summary",
                return_value="Summary of breakthrough",
            ),
            patch(
                "app.services.agentic.tools.perception_tools.extract_topic_tweets",
                return_value=[mock_tweet],
            ),
        ):
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = True
            mock_bm.get_context.return_value.__aenter__.return_value = mock_context
            mock_bm_cls.return_value = mock_bm

            res = await scrape_topic_timeline(
                topic_url="https://x.com/search?q=Breakthrough",
                user_id="user-valid-2",
                max_tweets=3,
            )
            assert res["success"] is True
            assert res["topic_url"] == "https://x.com/search?q=Breakthrough"
            assert res["grok_summary"] == "Summary of breakthrough"
            assert len(res["tweets"]) == 1
            assert res["tweets"][0]["author"] == "@researcher"
            assert res["tweets"][0]["likes"] == 120

    @pytest.mark.anyio
    async def test_scrape_topic_timeline_exception_handling(self) -> None:
        with patch(
            "app.services.agentic.tools.perception_tools.BrowserManager"
        ) as mock_bm_cls:
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = True
            mock_bm.get_context.side_effect = RuntimeError("Playwright connection lost")
            mock_bm_cls.return_value = mock_bm

            res = await scrape_topic_timeline(
                topic_url="https://x.com/search?q=Test",
                user_id="user-valid-3",
            )
            assert res["success"] is False
            assert "Playwright connection lost" in res["error"]

    @pytest.mark.anyio
    async def test_scrape_topic_timeline_blocks_post_navigation_redirect(self) -> None:
        mock_page = AsyncMock()
        mock_page.url = "http://169.254.169.254/latest/meta-data/"
        mock_context = AsyncMock()
        mock_context.pages = [mock_page]

        with patch(
            "app.services.agentic.tools.perception_tools.BrowserManager"
        ) as mock_bm_cls:
            mock_bm = MagicMock()
            mock_bm.session_exists.return_value = True
            mock_bm.get_context.return_value.__aenter__.return_value = mock_context
            mock_bm_cls.return_value = mock_bm

            res = await scrape_topic_timeline(
                topic_url="https://x.com/search?q=RedirectTest",
                user_id="user-redirect-victim",
            )
            assert res["success"] is False
            assert "redirected to unauthorized URL" in res["error"]
            assert res["tweets"] == []

    @pytest.mark.anyio
    async def test_scrape_topic_timeline_blocks_invalid_port_without_crashing(
        self,
    ) -> None:
        with patch(
            "app.services.agentic.tools.perception_tools.BrowserManager"
        ) as mock_bm_cls:
            res = await scrape_topic_timeline(
                topic_url="https://x.com:abc/search",
                user_id="user-port-test",
            )
            assert res["success"] is False
            assert "Invalid or unauthorized topic URL" in res["error"]
            mock_bm_cls.assert_not_called()


class TestOtherPerceptionTools:
    """Ensure other perception tools continue functioning properly."""

    @pytest.mark.anyio
    async def test_scrape_live_explore_trends_success(self) -> None:
        mock_result = MagicMock()
        mock_result.status = "success"
        mock_result.topics_found = 5
        mock_result.topics_scraped = 3
        mock_result.errors = []

        with patch(
            "app.services.agentic.tools.perception_tools.scrape_trending_topics",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            res = await scrape_live_explore_trends(user_id="user-test-1", max_topics=3)
            assert res["status"] == "success"
            assert res["topics_found"] == 5
            assert res["topics_scraped"] == 3

    @pytest.mark.anyio
    async def test_scrape_live_explore_trends_error(self) -> None:
        with patch(
            "app.services.agentic.tools.perception_tools.scrape_trending_topics",
            new_callable=AsyncMock,
            side_effect=RuntimeError("Scraper crash"),
        ):
            res = await scrape_live_explore_trends(user_id="user-test-1")
            assert res["status"] == "error"
            assert "Scraper crash" in res["errors"][0]

    @pytest.mark.anyio
    async def test_inspect_page_session_state(self) -> None:
        with patch(
            "app.services.agentic.tools.perception_tools.BrowserManager"
        ) as mock_bm_cls:
            mock_bm = MagicMock()
            mock_bm.verify_session = AsyncMock(
                return_value={
                    "connected": True,
                    "authenticated": True,
                    "page_state": "home",
                }
            )
            mock_bm_cls.return_value = mock_bm

            res = await inspect_page_session_state(user_id="user-test-2", platform="x")
            assert res["connected"] is True
            assert res["authenticated"] is True
