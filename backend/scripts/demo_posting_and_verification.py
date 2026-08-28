#!/usr/bin/env python3
"""Interactive terminal demonstration of CurationGraph, PostingGraph, and VerificationGraph with Self-Healing."""

from __future__ import annotations

import asyncio
import json
import os
import platform as sys_platform
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, NamedTuple

os.environ["PLAYWRIGHT_HEADLESS"] = "0"

from sqlalchemy import create_engine
from sqlmodel import Session, select

from app import crud
from app.core.config import settings
from app.models import User
from app.services.agentic.curation_graph import curate_and_draft_post
from app.services.agentic.posting_graph import publish_post_with_graph
from app.services.agentic.schemas import PostingGraphReport
from app.services.agentic.tools.context_tools import get_social_account_status

SELECTORS_PATH = (
    Path(__file__).parent.parent
    / "app"
    / "services"
    / "browser"
    / "selectors"
    / "x_selectors.json"
)


def _focus_chrome_on_macos() -> None:
    """Bring Google Chrome to the front on macOS so the user can watch the automation."""
    if sys_platform.system() == "Darwin":
        try:
            subprocess.run(
                [
                    "osascript",
                    "-e",
                    'tell application "Google Chrome" to activate',
                ],
                capture_output=True,
                check=False,
            )
        except Exception:
            pass


def _get_engine():
    """Resolve database engine for local host development or docker environment."""
    uri = str(settings.SQLALCHEMY_DATABASE_URI)
    if "@db:" in uri or "@db/" in uri:
        uri = uri.replace("@db:", "@localhost:").replace("@db/", "@localhost/")
        return create_engine(uri)
    return create_engine(uri)


db_engine = _get_engine()


class DemoPostContext(NamedTuple):
    user_id: str
    post_id: str
    content: str
    platform: str


def _print_banner() -> None:
    print("\n" + "═" * 78)
    print(" 🚀  LINKX END-TO-END AGENTIC CURATION, PUBLISHING & VERIFICATION DEMO")
    print("═" * 78)
    print(
        " Architecture: CurationGraph ➔ PostingGraph ➔ VerificationGraph ➔ PostgreSQL\n"
    )


async def _curate_and_create_draft(
    *, session: Session, user_id: str, platform: str
) -> DemoPostContext:
    """Curate and refine an AI draft using CurationGraph."""
    topic_title = (
        "Deterministic State Graphs & Self-Healing Agents in Modern AI Automation"
    )

    print("┌" + "─" * 76 + "┐")
    print(
        "│ STEP 1: AUTONOMOUS AI CURATION & DRAFT REFINEMENT (CURATIONGRAPH)          │"
    )
    print("└" + "─" * 76 + "┘")
    print(f" • Topic:          {topic_title}")
    print(f" • Platform:       {platform.upper()}")
    print(" • Generating & refining draft via CurationGraph...")

    curation_report = await curate_and_draft_post(
        user_id=user_id,
        topic_title=topic_title,
        platform=platform,
        target_tone="thought leadership",
        session=session,
    )

    post_id = curation_report.persisted_post_id
    if not post_id:
        raise RuntimeError("CurationGraph failed to persist draft to database")

    print(f' • Refined Draft:  "{curation_report.refined_content[:75]}..."')
    print(f" • Compliant:      {curation_report.is_compliant} ✅")
    print(f" • Persisted ID:   {post_id}\n")

    return DemoPostContext(
        user_id=user_id,
        post_id=post_id,
        content=curation_report.refined_content,
        platform=platform,
    )


def _display_step_2_accounts(*, user_id: str, session: Session) -> None:
    print("┌" + "─" * 76 + "┐")
    print(
        "│ STEP 2: PREFLIGHT ACCOUNT & CONNECTION DIAGNOSTICS                         │"
    )
    print("└" + "─" * 76 + "┘")
    acc_status = get_social_account_status(user_id=user_id, session=session)
    x_icon = "✅" if acc_status.x_connected else "❌"
    li_icon = "✅" if acc_status.linkedin_connected else "❌"

    print(
        f" • X (Twitter):    {x_icon} {'Connected (@' + str(acc_status.x_username) + ')' if acc_status.x_connected else 'Disconnected / Session Missing'}"
    )
    print(
        f" • LinkedIn:       {li_icon} {'Connected (' + str(acc_status.linkedin_display_name or acc_status.linkedin_email) + ')' if acc_status.linkedin_connected else 'Disconnected / Token Missing'}\n"
    )


def _inject_broken_x_selector() -> dict[str, Any]:
    """Backup selectors and inject an intentionally broken selector for X compose."""
    with open(SELECTORS_PATH, encoding="utf-8") as f:
        original = json.load(f)

    mutated = json.loads(json.dumps(original))
    mutated["compose"]["post_input"] = (
        "[data-testid='broken_tweetTextarea_999'], .broken-DraftEditor-nonexistent"
    )

    with open(SELECTORS_PATH, "w", encoding="utf-8") as f:
        json.dump(mutated, f, indent=2)

    print("┌" + "─" * 76 + "┐")
    print(
        "│ STEP 3: INJECT INTENTIONALLY BROKEN SELECTOR (TESTING SELF-HEALING)        │"
    )
    print("└" + "─" * 76 + "┘")
    print(" ⚠️  Mutated `compose.post_input` in x_selectors.json to:")
    print(f'    "{mutated["compose"]["post_input"]}"')
    print(
        " 🛡️  SelfHealingGraph will intercept DOM miss, diagnose with AI, & repair live!\n"
    )

    return original


def _restore_x_selectors(*, original: dict[str, Any]) -> None:
    """Restore original selector configuration if needed."""
    with open(SELECTORS_PATH, "w", encoding="utf-8") as f:
        json.dump(original, f, indent=2)


def _display_step_4_results(*, report: PostingGraphReport, duration: float) -> None:
    print("┌" + "─" * 76 + "┐")
    print(
        "│ STEP 4: POSTINGGRAPH EXECUTION & EMBEDDED VERIFICATION                     │"
    )
    print("└" + "─" * 76 + "┘")
    print(f" ✅ PostingGraph finished in {duration}s | Status: {report.status.upper()}")
    print(f" • Ground Truth Verified: {report.is_verified}")

    if report.published_urls:
        print(" 🌐 Live Published URLs:")
        for idx, u in enumerate(report.published_urls, start=1):
            print(f"    [{idx}] {u}")
    elif report.error:
        print(f" ⚠️ Publishing Status: {report.error}")

    if report.verification_report:
        v_rep = report.verification_report
        print(f" 🔍 Verification Subgraph Status: {v_rep.get('status', 'N/A').upper()}")
        for item in v_rep.get("items", []):
            print(
                f"    - {item.get('platform', 'x').upper()}: Verified={item.get('is_verified')} | Confidence={item.get('match_confidence', 0.0):.2f}"
            )
    print()


def _verify_database_record(*, session: Session, post_id: str) -> None:
    print("┌" + "─" * 76 + "┐")
    print(
        "│ STEP 5: POSTGRESQL PERSISTENCE & RELATIONAL INTEGRITY VERIFICATION        │"
    )
    print("└" + "─" * 76 + "┘")
    post = crud.get_post(session=session, post_id=uuid.UUID(post_id))
    if post:
        print(f" • Post ID:        {post.id}")
        print(f" • Status:         {post.status.upper()} ✅")
        print(f" • External ID:    {post.external_post_id}")
        print(f" • Published At:   {post.published_at}")
        print(f" • Error Message:  {post.error_message or 'None'}")
    else:
        print(f" ❌ Post not found in database: {post_id}")

    print("\n" + "═" * 78)
    print(" 🎉 DEMONSTRATION COMPLETE: MULTI-CHANNEL DISPATCH & VERIFICATION FINISHED")
    print("═" * 78 + "\n")


async def main() -> None:
    """Main execution flow for posting, self-healing, and verification demonstration."""
    _print_banner()

    platform_arg = sys.argv[1] if len(sys.argv) > 1 else "both"
    user_id_arg = sys.argv[2] if len(sys.argv) > 2 else None

    with Session(db_engine) as session:
        first_user = session.exec(select(User)).first()
        user_id = user_id_arg or (
            str(first_user.id) if first_user else "93c0700a-423f-42eb-8c91-0b90f300ca11"
        )
        # Step 1: Autonomous AI Curation via CurationGraph
        ctx = await _curate_and_create_draft(
            session=session, user_id=user_id, platform=platform_arg
        )

        # Step 2: Account diagnostics
        _display_step_2_accounts(user_id=user_id, session=session)

    # Step 3: Inject broken selector to demonstrate Self-Healing
    original_selectors = _inject_broken_x_selector()

    start_time = time.time()
    try:

        async def _delayed_focus() -> None:
            await asyncio.sleep(2.5)
            _focus_chrome_on_macos()

        asyncio.create_task(_delayed_focus())

        with Session(db_engine) as session:
            # Step 4: Multi-channel dispatch (LinkedIn REST + X Headed Self-Healing + Headed Verification)
            report = await publish_post_with_graph(
                user_id=user_id,
                post_id=ctx.post_id,
                platform=ctx.platform,
                headless=False,
                session=session,
            )
        duration = round(time.time() - start_time, 2)
        _display_step_4_results(report=report, duration=duration)

        with Session(db_engine) as session:
            # Step 5: PostgreSQL persistence inspection
            _verify_database_record(session=session, post_id=ctx.post_id)
    except Exception as exc:
        print(f"\n❌ PostingGraph demo failed with exception: {exc}")
    finally:
        _restore_x_selectors(original=original_selectors)


if __name__ == "__main__":
    asyncio.run(main())
