"""Dataclasses and result models for X.com scraping pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.services.browser.actions import EvasionMouse


@dataclass
class TopicFailure:
    """Records why a single topic failed to scrape."""

    topic_id: str
    reason: str
    detail: str = ""


@dataclass
class ScrapeResult:
    """Structured result from a scrape run."""

    status: str
    topics_found: int = 0
    topics_scraped: int = 0
    topics_failed: list[TopicFailure] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


@dataclass
class TopicRecordPayload:
    """Payload bundle for saving scraped topic records."""

    db_user_id: Any
    topic_url: str
    title_data: dict[str, Any]
    summary_text: str | None
    conversations: list[dict[str, Any]]
    scraped_at: datetime


@dataclass
class TopicProcessContext:
    """Execution context for processing a single topic."""

    page: Any
    mouse: EvasionMouse
    target_id: str
    target_title: str
    is_href: bool
    db_user_id: Any
    config: dict[str, Any]


@dataclass
class CandidateScrapeContext:
    """Execution context for iterating candidate topics."""

    page: Any
    mouse: EvasionMouse
    news_urls: list[tuple[str, bool]]
    news_titles: dict[str, str]
    db_user_id: Any
    config: dict[str, Any]
    max_topics: int
    result: ScrapeResult
