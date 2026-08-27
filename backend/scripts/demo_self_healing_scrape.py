"""Live Headed Demonstration: Selector Failure -> AI Self-Healing -> Full Headed Scrape.

Launches the authenticated user session in a headed Chrome window with an intentionally
broken selector. Demonstrates the complete self-healing and scraping lifecycle:
1. Intentionally faked/broken selector loaded in configuration.
2. Initial overlay diagnosis & session recovery via SessionRecoveryGraph.
3. find_or_heal_element detects element miss and activates SelfHealingGraph.
4. Gemini AI analyzes live DOM snippet, suggests candidate selectors, and probes them on screen.
5. In-memory & disk configuration hot-patched with verified selector.
6. Scraper resumes seamlessly: discovers all topics, glides visual mouse cursor,
   scrolls timelines, extracts Grok summary + 5 top tweets, and persists to PostgreSQL.

Usage:
    cd backend && uv run python scripts/demo_self_healing_scrape.py [user_id] [max_topics]
"""

from __future__ import annotations

# ruff: noqa: E402
import asyncio
import copy
import json
import os
import platform
import subprocess
import sys
import time
import warnings
from pathlib import Path
from typing import Any

# Silence verbose logs
warnings.filterwarnings("ignore")
os.environ["LITELLM_LOG"] = "ERROR"

# Add backend directory to sys.path
sys.path.append(str(Path(__file__).parent.parent))

from sqlmodel import Session, create_engine, select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.db import engine  # noqa: E402
from app.models import User  # noqa: E402
from app.services.agentic import recover_page_session  # noqa: E402
from app.services.agentic.self_healing_graph import heal_selector  # noqa: E402
from app.services.browser.actions import (  # noqa: E402
    EvasionMouse,
    human_navigation,
    install_visual_cursor,
    random_delay,
)
from app.services.browser.diagnostics import (  # noqa: E402
    extract_grok_summary,
)
from app.services.browser.manager import BrowserManager  # noqa: E402
from app.services.browser.tools import (  # noqa: E402
    validate_selector_candidate,
)
from scripts.scrape_trending_topics import (  # noqa: E402
    extract_topic_tweets,
    parse_post_count,
    parse_title_metadata,
)


def _get_engine():
    """Resolve database engine for local host development or docker environment."""
    uri = str(settings.SQLALCHEMY_DATABASE_URI)
    if "@db:" in uri or "@db/" in uri:
        uri = uri.replace("@db:", "@localhost:").replace("@db/", "@localhost/")
        return create_engine(uri)
    return engine


db_engine = _get_engine()


def _focus_chrome_on_macos() -> None:
    """Bring Chrome to the front on macOS."""
    if platform.system() == "Darwin":
        try:
            subprocess.run(
                ["osascript", "-e", 'tell application "Google Chrome" to activate'],
                capture_output=True,
                check=False,
            )
        except Exception:
            pass


def _print_banner() -> None:
    """Print demo run banner."""
    print("\n" + "═" * 78)
    print(" 🛠️  LINKX LIVE HEADED DEMO: AI SELF-HEALING & AUTONOMOUS SCRAPING")
    print("═" * 78)
    print(
        " Engine: SelfHealingGraph + SessionRecoveryGraph + EvasionMouse + Gemini AI\n"
    )


def _prepare_corrupted_config(
    *, real_config_path: Path, temp_config_path: Path
) -> tuple[dict[str, Any], str]:
    """Create isolated config copy with an intentionally corrupted selector."""
    with open(real_config_path, encoding="utf-8") as f:
        real_config = json.load(f)

    broken_config = copy.deepcopy(real_config)
    fake_broken_selector = (
        "div[data-testid='broken_fake_sidebar_container_v99_corrupted']"
    )
    broken_config["selectors"]["sidebar_container"] = fake_broken_selector

    with open(temp_config_path, "w", encoding="utf-8") as f:
        json.dump(broken_config, f, indent=2)

    return broken_config, fake_broken_selector


async def _diagnose_and_heal_initial_selector(
    *,
    page: Any,
    temp_config_path: Path,
    broken_config: dict[str, Any],
    fake_broken_selector: str,
) -> str | None:
    """Detect element miss and trigger SelfHealingGraph."""
    print("\n┌" + "─" * 76 + "┐")
    print(
        "│ STEP 3: ELEMENT MISS DETECTED -> AUTONOMOUS AI SELF-HEALING SUPERVISOR     │"
    )
    print("└" + "─" * 76 + "┘")
    print(
        f" 🔍 Probing selector 'selectors.sidebar_container': \"{fake_broken_selector}\""
    )

    probe_res = await validate_selector_candidate(
        page=page, selector=fake_broken_selector, timeout_ms=2000
    )
    print(
        f" ⚠️ Selector Miss! Found: {probe_res['found']}, Visible: {probe_res['visible']}"
    )
    print(" 🤖 Invoking LangGraph SelfHealingGraph supervisor...")

    healed_selector = await heal_selector(
        page=page,
        failed_selector_key="selectors.sidebar_container",
        config_path=temp_config_path,
        selectors_dict=broken_config,
    )

    if healed_selector:
        print(f" ✨ {healed_selector} discovered & verified on live DOM! ✅")
        print(
            f" 💾 In-Memory Config Hot-Patched: 'selectors.sidebar_container' -> \"{healed_selector}\""
        )
        print(f" 📄 On-Disk Config Updated:       {temp_config_path} ✅")

    return healed_selector


async def _scrape_single_trend_item(
    *,
    page: Any,
    mouse: EvasionMouse,
    idx: int,
    config: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]], str | None]:
    """Visibly click trend card, read timeline, and extract tweets."""
    print("\n" + "─" * 70)
    print(f" 📌 Targeting Trend Item #{idx + 1} on Explore Screen")
    print("─" * 70)

    current_trend_elem = page.locator("[data-testid='trend']").nth(idx)
    if await current_trend_elem.count() == 0:
        await mouse.human_scroll(scrolls=1)
        current_trend_elem = page.locator("[data-testid='trend']").nth(idx)

    trend_raw_text = ""
    try:
        trend_raw_text = await current_trend_elem.inner_text()
    except Exception:
        pass

    meta = parse_title_metadata(trend_raw_text) if trend_raw_text else {}
    topic_title = meta.get("topic_title") or (
        trend_raw_text.split("\n")[1]
        if "\n" in trend_raw_text
        else (trend_raw_text or f"Trending Topic #{idx + 1}")
    )
    category = meta.get("category") or "Trending"
    post_count = parse_post_count(meta.get("post_count")) or 0

    print(f" 🏷️  Identified: '{topic_title}' ({category} · {post_count:,} posts)")
    print(f" 🖱️  Gliding glowing mouse to trend card #{idx + 1}...")
    await mouse.human_click(locator=current_trend_elem)

    await random_delay(min_sec=2.0, max_sec=3.0)
    try:
        await page.wait_for_selector("[data-testid='tweet']", timeout=6000)
    except Exception:
        pass

    current_url = page.url
    print(f"    🧭 [NAV LOG] Landed on '{topic_title}' Timeline | URL: {current_url}")

    topic_info = {
        "topic_url": current_url,
        "topic_title": topic_title,
        "category": category,
        "post_count": post_count,
    }

    print(" 📜 Reading timeline tweets with human smooth scrolling...")
    await mouse.human_scroll(scrolls=2)

    summary = await extract_grok_summary(page)
    if summary:
        print(f" 🤖 Grok Summary: {summary[:80]}...")

    raw_tweets = await extract_topic_tweets(
        page=page, topic_url=current_url, selectors=config
    )
    tweets_data = [
        {
            "author_handle": tw.author_handle,
            "text": tw.text,
            "replies": tw.replies or 0,
            "retweets": tw.retweets or 0,
            "likes": tw.likes or 0,
            "views": tw.views or 0,
        }
        for tw in (raw_tweets or [])
    ]
    print(
        f" ✅ Extracted {len(tweets_data)} timeline tweets with live engagement metrics"
    )

    print(" 🔙 Returning to Explore page...")
    back_btn = page.locator("[data-testid='app-bar-back']").first
    explore_tab = page.locator(
        "[data-testid='AppTabBar_Explore_Link'], a[href='/explore']"
    ).first

    if await back_btn.count() > 0 and await back_btn.is_visible():
        await mouse.human_click(locator=back_btn)
    elif await explore_tab.count() > 0 and await explore_tab.is_visible():
        await mouse.human_click(locator=explore_tab)
    else:
        await page.go_back()

    await random_delay(min_sec=1.5, max_sec=2.5)
    try:
        await page.wait_for_selector("[data-testid='trend']", timeout=6000)
    except Exception:
        pass

    return topic_info, tweets_data, summary


def _persist_single_topic_with_tweets(
    *,
    session: Session,
    target_user_id: Any,
    top: dict[str, Any],
    tweets: list[dict[str, Any]],
) -> tuple[Any, list[Any]]:
    """Upsert topic and insert corresponding tweets into DB."""
    from datetime import datetime, timezone

    from app.models import TrendingTopic as TTModel
    from app.models import TrendingTweet as TTwModel

    now = datetime.now(timezone.utc)
    t_url = top["topic_url"]
    existing = session.exec(select(TTModel).where(TTModel.topic_url == t_url)).first()

    if not existing:
        existing = TTModel(
            user_id=target_user_id,
            topic_url=t_url,
            topic_title=top["topic_title"],
            category=top.get("category"),
            post_count=top.get("post_count"),
            scraped_at=now,
        )
        session.add(existing)
    else:
        existing.scraped_at = now
        session.add(existing)
    session.commit()
    session.refresh(existing)

    for tw in tweets:
        session.add(
            TTwModel(
                topic_id=existing.id,
                author_handle=tw["author_handle"],
                text=tw["text"],
                replies=tw["replies"],
                retweets=tw["retweets"],
                likes=tw["likes"],
                views=tw["views"],
            )
        )
    session.commit()

    attached = session.exec(
        select(TTwModel).where(TTwModel.topic_id == existing.id)
    ).all()
    return existing, list(attached)


def _display_saved_topic_verification(*, existing: Any, attached: list[Any]) -> None:
    """Display topic details and attached tweets from database."""
    print(f" • Topic '{existing.topic_title}':")
    print(f"    - ID:        {existing.id}")
    print(f"    - Category:  {existing.category or 'Trending'}")
    print(f"    - Post Count:{existing.post_count or 0:,}")
    print(f"    - Tweets DB: {len(attached)} attached in 'trending_tweet' ✅")
    for i, tw_rec in enumerate(attached[:3], 1):
        s_text = (tw_rec.text or "").replace("\n", " ")[:70]
        print(
            f'       [{i}] {tw_rec.author_handle}: "{s_text}..." ({tw_rec.likes or 0:,} likes, {tw_rec.retweets or 0:,} reposts)'
        )


def _persist_and_display_demo_topics(
    *,
    selected_topics: list[dict[str, Any]],
    topic_tweets_map: dict[str, list[dict[str, Any]]],
) -> None:
    """Save scraped topics and tweets into PostgreSQL and print verification."""
    print("\n┌" + "─" * 76 + "┐")
    print(
        "│ STEP 5: POSTGRESQL PERSISTENCE & RELATIONAL INTEGRITY VERIFICATION        │"
    )
    print("└" + "─" * 76 + "┘")

    with Session(db_engine) as session:
        db_user = session.exec(select(User)).first()
        target_user_id = db_user.id if db_user else None

        for top in selected_topics:
            t_url = top["topic_url"]
            tweets = topic_tweets_map.get(t_url, [])
            existing, attached = _persist_single_topic_with_tweets(
                session=session,
                target_user_id=target_user_id,
                top=top,
                tweets=tweets,
            )
            _display_saved_topic_verification(existing=existing, attached=attached)


def _resolve_demo_user_id(*, user_id_arg: str | None) -> str:
    """Resolve demo user ID from args or database."""
    if user_id_arg:
        return user_id_arg
    with Session(db_engine) as session:
        first_user = session.exec(select(User)).first()
        return (
            str(first_user.id) if first_user else "93c0700a-423f-42eb-8c91-0b90f300ca11"
        )


from typing import NamedTuple


class DemoSetup(NamedTuple):
    broken_config: dict[str, Any]
    fake_broken_selector: str
    temp_config_path: Path


async def _run_demo_session(
    *,
    manager: BrowserManager,
    setup: DemoSetup,
    max_topics_arg: int,
) -> float:
    """Execute the headed self-healing session."""
    start_time = time.time()
    async with manager.get_context("x", headless=False) as context:
        page = context.pages[0] if context.pages else await context.new_page()
        for p in context.pages[1:]:
            await p.close()

        await install_visual_cursor(page)
        mouse = EvasionMouse(page)
        await mouse.start_idle()

        print("┌" + "─" * 76 + "┐")
        print(
            "│ STEP 2: SESSION RECOVERY & OVERLAY DIAGNOSIS (SESSIONRECOVERYGRAPH)        │"
        )
        print("└" + "─" * 76 + "┘")
        await human_navigation(page=page, url="https://x.com/explore")
        await random_delay(min_sec=1.5, max_sec=2.5)

        rec = await recover_page_session(page=page, expected_state="home", mouse=mouse)
        print(f" • Page State:        {rec.page_state}")
        print(f" • Overlays Diagnosed:{rec.overlay_type or 'None (Clean Page)'}")
        print(f" • Recovery Action:   {rec.recovery_action or 'None required'} ✅")

        healed_selector = await _diagnose_and_heal_initial_selector(
            page=page,
            temp_config_path=setup.temp_config_path,
            broken_config=setup.broken_config,
            fake_broken_selector=setup.fake_broken_selector,
        )

        if not healed_selector:
            print("❌ AI Self-Healing failed to find a valid selector.")
            return 0.0

        print("\n┌" + "─" * 76 + "┐")
        print(
            "│ STEP 4: AUTONOMOUS HEADED SCRAPING CONTINUES WITH HEALED SELECTOR          │"
        )
        print("└" + "─" * 76 + "┘")

        trend_locators = page.locator("[data-testid='trend']")
        total_trends = await trend_locators.count()
        topics_to_process = min(max_topics_arg, max(1, total_trends))

        selected_topics: list[dict[str, Any]] = []
        topic_tweets_map: dict[str, list[dict[str, Any]]] = {}
        topic_summaries: dict[str, str] = {}

        for idx in range(topics_to_process):
            t_info, t_tweets, t_sum = await _scrape_single_trend_item(
                page=page,
                mouse=mouse,
                idx=idx,
                config=setup.broken_config,
            )
            selected_topics.append(t_info)
            topic_tweets_map[t_info["topic_url"]] = t_tweets
            if t_sum:
                topic_summaries[t_info["topic_url"]] = t_sum

        _persist_and_display_demo_topics(
            selected_topics=selected_topics, topic_tweets_map=topic_tweets_map
        )

        await mouse.stop_idle()
        return round(time.time() - start_time, 2)


async def main() -> None:
    """Main execution flow for headed self-healing scraping demonstration."""
    _print_banner()

    user_id_arg = sys.argv[1] if len(sys.argv) > 1 else None
    max_topics_arg = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    user_id = _resolve_demo_user_id(user_id_arg=user_id_arg)

    print("┌" + "─" * 76 + "┐")
    print(
        "│ STEP 1: INJECTING INTENTIONALLY BROKEN SELECTOR CONFIGURATION               │"
    )
    print("└" + "─" * 76 + "┘")

    real_config_path = Path(__file__).parent.parent / "scrape_config.json"
    temp_config_path = Path("/tmp/linkx_demo_selectors.json")
    broken_config, fake_broken_selector = _prepare_corrupted_config(
        real_config_path=real_config_path, temp_config_path=temp_config_path
    )

    print(f" • Corrupted Target Config: {temp_config_path}")
    print(" • Corrupted Key:           'selectors.sidebar_container'")
    print(f' • Corrupted Selector:      "{fake_broken_selector}" ❌')
    print(" • Browser Mode:            HEADED (Google Chrome opening on your desktop)")
    print(" • Visual Cursor:           Active (Glowing neon orange tracker)\n")

    async def _delayed_focus() -> None:
        await asyncio.sleep(1.5)
        _focus_chrome_on_macos()

    asyncio.create_task(_delayed_focus())

    manager = BrowserManager(user_id=user_id)
    if not manager.session_exists("x"):
        print("❌ No authenticated X.com session found. Please authenticate first.")
        return

    setup = DemoSetup(
        broken_config=broken_config,
        fake_broken_selector=fake_broken_selector,
        temp_config_path=temp_config_path,
    )

    duration = await _run_demo_session(
        manager=manager,
        setup=setup,
        max_topics_arg=max_topics_arg,
    )

    print(
        f"\n🏁 Headed Self-Healing Scraping Complete in {duration}s! All systems operational. 🚀"
    )


if __name__ == "__main__":
    asyncio.run(main())
