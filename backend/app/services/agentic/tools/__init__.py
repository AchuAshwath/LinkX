"""LinkX Autonomous Social Media Supervisor Tools Registry.

Exports all lean context, perception, verification, curation, persistence, and diagnostics tools.
"""

from __future__ import annotations

from app.services.agentic.tools.context_tools import (
    get_latest_published_post,
    get_latest_scraped_trends,
    get_recent_post_history,
    get_social_account_status,
    get_topic_tweets_and_summary,
)
from app.services.agentic.tools.curation_tools import (
    draft_social_post,
    refine_post_draft,
    validate_post_constraints,
)
from app.services.agentic.tools.diagnostics_tools import (
    inspect_dom_snippet,
    probe_and_patch_broken_selector,
    trigger_autonomous_selector_healing,
)
from app.services.agentic.tools.perception_tools import (
    inspect_page_session_state,
    scrape_live_explore_trends,
    scrape_topic_timeline,
)
from app.services.agentic.tools.persistence_tools import (
    delete_post_from_db,
    publish_post_live,
    save_draft_post,
    schedule_post_in_db,
    update_post_in_db,
)
from app.services.agentic.tools.verification_tools import (
    verify_post_on_live_profile,
    verify_post_url_status,
)

__all__ = [
    # Context
    "get_latest_scraped_trends",
    "get_topic_tweets_and_summary",
    "get_latest_published_post",
    "get_recent_post_history",
    "get_social_account_status",
    # Perception
    "scrape_live_explore_trends",
    "scrape_topic_timeline",
    "inspect_page_session_state",
    # Verification
    "verify_post_on_live_profile",
    "verify_post_url_status",
    # Diagnostics & Self-Healing
    "inspect_dom_snippet",
    "probe_and_patch_broken_selector",
    "trigger_autonomous_selector_healing",
    # Curation
    "draft_social_post",
    "validate_post_constraints",
    "refine_post_draft",
    # Persistence
    "save_draft_post",
    "schedule_post_in_db",
    "publish_post_live",
    "update_post_in_db",
    "delete_post_from_db",
]
