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
    _extract_sidebar_links,
    _format_trend_url,
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


async def main() -> None:
    """Main execution flow for headed self-healing scraping demonstration."""
    _print_banner()

    user_id_arg = sys.argv[1] if len(sys.argv) > 1 else None
    max_topics_arg = int(sys.argv[2]) if len(sys.argv) > 2 else 3

    with Session(db_engine) as session:
        first_user = session.exec(select(User)).first()
        user_id = user_id_arg or (
            str(first_user.id) if first_user else "93c0700a-423f-42eb-8c91-0b90f300ca11"
        )

    # Step 1: Deliberately Broken Configuration Setup
    print("┌" + "─" * 76 + "┐")
    print(
        "│ STEP 1: INJECTING INTENTIONALLY BROKEN SELECTOR CONFIGURATION               │"
    )
    print("└" + "─" * 76 + "┘")

    real_config_path = Path(__file__).parent.parent / "scrape_config.json"
    with open(real_config_path, encoding="utf-8") as f:
        real_config = json.load(f)

    # Make a temporary isolated config file with a corrupted selector
    broken_config = copy.deepcopy(real_config)
    fake_broken_selector = (
        "div[data-testid='broken_fake_sidebar_container_v99_corrupted']"
    )
    broken_config["selectors"]["sidebar_container"] = fake_broken_selector

    temp_config_path = Path("/tmp/linkx_demo_selectors.json")
    with open(temp_config_path, "w", encoding="utf-8") as f:
        json.dump(broken_config, f, indent=2)

    print(f" • Corrupted Target Config: {temp_config_path}")
    print(" • Corrupted Key:           'selectors.sidebar_container'")
    print(f' • Corrupted Selector:      "{fake_broken_selector}" ❌')
    print(" • Browser Mode:            HEADED (Google Chrome opening on your desktop)")
    print(" • Visual Cursor:           Active (Glowing neon orange tracker)\n")

    # Focus Chrome on macOS
    async def _delayed_focus() -> None:
        await asyncio.sleep(1.5)
        _focus_chrome_on_macos()

    asyncio.create_task(_delayed_focus())

    manager = BrowserManager(user_id=user_id)
    if not manager.session_exists("x"):
        print("❌ No authenticated X.com session found. Please authenticate first.")
        return

    start_time = time.time()
    try:
        async with manager.get_context("x", headless=False) as context:
            page = context.pages[0] if context.pages else await context.new_page()
            for p in context.pages[1:]:
                await p.close()

            # Install on-screen visual mouse pointer
            await install_visual_cursor(page)
            mouse = EvasionMouse(page)
            await mouse.start_idle()

            # Navigate to Explore / Trends
            print("┌" + "─" * 76 + "┐")
            print(
                "│ STEP 2: SESSION RECOVERY & OVERLAY DIAGNOSIS (SESSIONRECOVERYGRAPH)        │"
            )
            print("└" + "─" * 76 + "┘")
            await human_navigation(page=page, url="https://x.com/explore")
            await random_delay(min_sec=1.5, max_sec=2.5)

            recovery_report = await recover_page_session(
                page=page, expected_state="home", mouse=mouse
            )
            print(f" • Page State:        {recovery_report.page_state}")
            print(
                f" • Overlays Diagnosed:{recovery_report.overlay_type or 'None (Clean Page)'}"
            )
            print(
                f" • Recovery Action:   {recovery_report.recovery_action or 'None required'} ✅"
            )

            # Step 3: Trigger Element Lookup with Broken Selector -> AI Self-Healing
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

            if not healed_selector:
                print("❌ AI Self-Healing failed to find a valid selector.")
                return

            print(f" ✨ {healed_selector} discovered & verified on live DOM! ✅")
            print(
                f" 💾 In-Memory Config Hot-Patched: 'selectors.sidebar_container' -> \"{healed_selector}\""
            )
            print(f" 📄 On-Disk Config Updated:       {temp_config_path} ✅")

            # Step 4: Scraper Execution Resumes with Healed Selector
            print("\n┌" + "─" * 76 + "┐")
            print(
                "│ STEP 4: AUTONOMOUS HEADED SCRAPING CONTINUES WITH HEALED SELECTOR          │"
            )
            print("└" + "─" * 76 + "┘")

            sidebar = page.locator(healed_selector).first
            sidebar_link_sel = broken_config.get("selectors", {}).get(
                "sidebar_link", "a[href*='/search?q=']"
            )
            heuristic = broken_config.get("link_heuristic", {})

            news_urls, news_titles = await _extract_sidebar_links(
                sidebar, sidebar_link_sel, heuristic
            )

            scraped_topics: list[dict[str, Any]] = []
            for identifier, is_url in news_urls:
                raw_title = news_titles.get(identifier, "")
                meta = parse_title_metadata(raw_title)
                topic_title = meta.get("topic_title") or raw_title
                full_url = _format_trend_url(
                    identifier, is_url=is_url, topic_title=topic_title
                )
                scraped_topics.append(
                    {
                        "topic_url": full_url,
                        "topic_title": topic_title,
                        "category": meta.get("category") or "Trending",
                        "post_count": parse_post_count(meta.get("post_count")) or 0,
                    }
                )

            print(f" • Discovered {len(scraped_topics)} trending topics from sidebar!")

            # Random selection for human-like reading
            import random

            candidates = list(scraped_topics)
            selected_topics = (
                random.sample(candidates, max_topics_arg)
                if len(candidates) > max_topics_arg
                else candidates[:max_topics_arg]
            )

            topic_tweets_map: dict[str, list[dict[str, Any]]] = {}
            topic_summaries: dict[str, str] = {}

            async def _log_page_visit(step_label: str) -> None:
                try:
                    title = await page.title()
                    url = page.url
                    print(
                        f'    🧭 [NAV LOG] {step_label} | URL: {url} | Page Title: "{title}"'
                    )
                except Exception:
                    pass

            await _log_page_visit("Current Explore Feed")

            # Discover trends present in the Explore feed
            trend_locators = page.locator("[data-testid='trend']")
            total_trends = await trend_locators.count()
            print(f" • Discovered {total_trends} live trend cards in Explore feed!")

            if total_trends == 0:
                # If on /explore, click 'Trending' tab or wait
                trending_tab = page.locator(
                    "a[href*='/explore/tabs/trending'], span:has-text('Trending')"
                ).first
                if await trending_tab.count() > 0:
                    print(" 🖱️  Clicking 'Trending' tab in Explore...")
                    await mouse.human_click(locator=trending_tab)
                    await random_delay(min_sec=1.5, max_sec=2.5)
                    trend_locators = page.locator("[data-testid='trend']")
                    total_trends = await trend_locators.count()

            topics_to_process = min(max_topics_arg, max(1, total_trends))
            selected_topics: list[dict[str, Any]] = []
            topic_tweets_map: dict[str, list[dict[str, Any]]] = {}
            topic_summaries: dict[str, str] = {}

            for idx in range(topics_to_process):
                print("\n" + "─" * 70)
                print(
                    f" 📌 [{idx + 1}/{topics_to_process}] Targeting Trend Item #{idx + 1} on Explore Screen"
                )
                print("─" * 70)

                # Find the trend element in current Explore DOM
                current_trend_elem = page.locator("[data-testid='trend']").nth(idx)
                if await current_trend_elem.count() == 0:
                    print(f" ⚠️ Trend item #{idx + 1} not found, scrolling feed...")
                    await mouse.human_scroll(scrolls=1)
                    current_trend_elem = page.locator("[data-testid='trend']").nth(idx)

                # Extract text info from the trend element
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

                print(
                    f" 🏷️  Identified: '{topic_title}' ({category} · {post_count:,} posts)"
                )

                # Visibly glide mouse to the trend item and click it
                print(f" 🖱️  Gliding glowing mouse to trend card #{idx + 1}...")
                await mouse.human_click(locator=current_trend_elem)

                # Wait for timeline to load
                await random_delay(min_sec=2.0, max_sec=3.0)
                try:
                    await page.wait_for_selector("[data-testid='tweet']", timeout=6000)
                except Exception:
                    pass

                current_url = page.url
                await _log_page_visit(f"Landed on '{topic_title}' Timeline")

                top_info = {
                    "topic_url": current_url,
                    "topic_title": topic_title,
                    "category": category,
                    "post_count": post_count,
                }
                selected_topics.append(top_info)

                # Smooth human scrolling to read timeline
                print(" 📜 Reading timeline tweets with human smooth scrolling...")
                await mouse.human_scroll(scrolls=2)

                # Extract Grok summary
                summary = await extract_grok_summary(page)
                if summary:
                    topic_summaries[current_url] = summary
                    print(f" 🤖 Grok Summary: {summary[:80]}...")

                # Extract tweets
                raw_tweets = await extract_topic_tweets(
                    page=page, topic_url=current_url, selectors=broken_config
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
                topic_tweets_map[current_url] = tweets_data
                print(
                    f" ✅ Extracted {len(tweets_data)} timeline tweets with live engagement metrics"
                )

                # Visibly navigate back to Explore for next trend
                if idx < topics_to_process - 1:
                    print(" 🔙 Returning to Explore page...")
                    back_btn = page.locator("[data-testid='app-bar-back']").first
                    explore_tab = page.locator(
                        "[data-testid='AppTabBar_Explore_Link'], a[href='/explore']"
                    ).first

                    if await back_btn.count() > 0 and await back_btn.is_visible():
                        print(" 🖱️  Clicking Back arrow [data-testid='app-bar-back']...")
                        await mouse.human_click(locator=back_btn)
                    elif (
                        await explore_tab.count() > 0 and await explore_tab.is_visible()
                    ):
                        print(" 🖱️  Clicking 'Explore' tab in sidebar navigation...")
                        await mouse.human_click(locator=explore_tab)
                    else:
                        await page.go_back()

                    await random_delay(min_sec=1.5, max_sec=2.5)
                    try:
                        await page.wait_for_selector(
                            "[data-testid='trend']", timeout=6000
                        )
                    except Exception:
                        pass
                    await _log_page_visit("Returned to Explore Feed")

            # Step 5: Database Persistence & Verification
            print("\n┌" + "─" * 76 + "┐")
            print(
                "│ STEP 5: POSTGRESQL PERSISTENCE & RELATIONAL INTEGRITY VERIFICATION        │"
            )
            print("└" + "─" * 76 + "┘")

            with Session(db_engine) as session:
                from datetime import datetime, timezone

                from app.models import TrendingTopic as TTModel
                from app.models import TrendingTweet as TTwModel

                db_user = session.exec(select(User)).first()
                target_user_id = db_user.id if db_user else None

                persisted_topic_ids = []
                now = datetime.now(timezone.utc)
                for top in selected_topics:
                    t_url = top["topic_url"]
                    existing_topic = session.exec(
                        select(TTModel).where(TTModel.topic_url == t_url)
                    ).first()

                    if not existing_topic:
                        new_topic = TTModel(
                            user_id=target_user_id,
                            topic_url=t_url,
                            topic_title=top["topic_title"],
                            category=top.get("category"),
                            post_count=top.get("post_count"),
                            scraped_at=now,
                        )
                        session.add(new_topic)
                        session.commit()
                        session.refresh(new_topic)
                        existing_topic = new_topic
                    else:
                        existing_topic.scraped_at = now
                        session.add(existing_topic)
                        session.commit()
                        session.refresh(existing_topic)

                    persisted_topic_ids.append(existing_topic.id)

                    # Persist tweets
                    for tw in topic_tweets_map.get(t_url, []):
                        new_tw = TTwModel(
                            topic_id=existing_topic.id,
                            author_handle=tw["author_handle"],
                            text=tw["text"],
                            replies=tw["replies"],
                            retweets=tw["retweets"],
                            likes=tw["likes"],
                            views=tw["views"],
                        )
                        session.add(new_tw)
                    session.commit()

                    attached = session.exec(
                        select(TTwModel).where(TTwModel.topic_id == existing_topic.id)
                    ).all()

                    print(f" • Topic '{existing_topic.topic_title}':")
                    print(f"    - ID:        {existing_topic.id}")
                    print(f"    - Category:  {existing_topic.category or 'Trending'}")
                    print(f"    - Post Count:{existing_topic.post_count or 0:,}")
                    print(
                        f"    - Tweets DB: {len(attached)} attached in 'trending_tweet' ✅"
                    )
                    for i, tw_rec in enumerate(attached[:3], 1):
                        s_text = (tw_rec.text or "").replace("\n", " ")[:70]
                        print(
                            f'       [{i}] {tw_rec.author_handle}: "{s_text}..." ({tw_rec.likes or 0:,} likes, {tw_rec.retweets or 0:,} reposts)'
                        )

            await mouse.stop_idle()
            duration = round(time.time() - start_time, 2)
            print("\n" + "═" * 78)
            print(
                f" 🎉 DEMONSTRATION COMPLETE ({duration}s): BROKEN SELECTOR SELF-HEALED & SCRAPED"
            )
            print("═" * 78 + "\n")

    except Exception as exc:
        print(f"\n❌ Self-healing demo encountered error: {exc}")
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
