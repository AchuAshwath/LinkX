#!/usr/bin/env python3
"""Interactive terminal demonstration of PostingGraph and VerificationGraph."""

from __future__ import annotations

import asyncio
import sys
import time
import uuid
from typing import NamedTuple

from sqlalchemy import create_engine
from sqlmodel import Session, select

from app import crud
from app.core.config import settings
from app.models import Post, PostCreate, User
from app.services.agentic.posting_graph import publish_post_with_graph
from app.services.agentic.schemas import PostingGraphReport
from app.services.agentic.tools.context_tools import get_social_account_status


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
    print(" 🚀  LINKX MULTI-CHANNEL AGENTIC PUBLISHING & GROUND-TRUTH VERIFICATION")
    print("═" * 78)
    print(
        " Engine: PostingGraph + VerificationGraph + EvasionMouse + LinkedIn REST API\n"
    )


def _resolve_or_create_draft(
    *, session: Session, user_id: str, platform: str
) -> DemoPostContext:
    """Find recent draft post or create a demonstration draft."""
    user_uuid = uuid.UUID(user_id)
    statement = (
        select(Post)
        .where(Post.owner_id == user_uuid, Post.status == "draft")
        .order_by(Post.created_at.desc())  # type: ignore[attr-defined]
    )
    existing_draft = session.exec(statement).first()

    if existing_draft:
        return DemoPostContext(
            user_id=user_id,
            post_id=str(existing_draft.id),
            content=existing_draft.content,
            platform=platform or existing_draft.platform,
        )

    # Create synthetic demonstration draft
    sample_content = (
        "Autonomous AI agent swarms are redefining workflows in 2026. "
        "From self-healing web scrapers to multi-channel publishing with "
        "ground-truth verification, the era of action is here. #AIAgents #LangGraph"
    )
    post_in = PostCreate(
        content=sample_content,
        platform=platform,
        method="agent",
        status="draft",
    )
    new_post = crud.create_post(session=session, post_in=post_in, owner_id=user_uuid)
    return DemoPostContext(
        user_id=user_id,
        post_id=str(new_post.id),
        content=new_post.content,
        platform=platform,
    )


def _display_step_1_context(*, ctx: DemoPostContext) -> None:
    print("┌" + "─" * 76 + "┐")
    print(
        "│ STEP 1: TARGET DRAFT POST CONTEXT (FROM POSTGRESQL)                       │"
    )
    print("└" + "─" * 76 + "┘")
    print(f" • Post ID:        {ctx.post_id}")
    print(f" • User ID:        {ctx.user_id}")
    print(f" • Platform:       {ctx.platform.upper()}")
    print(f' • Draft Content:  "{ctx.content[:75]}..."\n')


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


def _display_step_3_and_4_results(
    *, report: PostingGraphReport, duration: float
) -> None:
    print("┌" + "─" * 76 + "┐")
    print(
        "│ STEP 3 & 4: POSTINGGRAPH EXECUTION & EMBEDDED VERIFICATION                 │"
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
    """Main execution flow for posting and verification demonstration."""
    _print_banner()

    platform_arg = sys.argv[1] if len(sys.argv) > 1 else "x"
    user_id_arg = sys.argv[2] if len(sys.argv) > 2 else None

    with Session(db_engine) as session:
        first_user = session.exec(select(User)).first()
        user_id = user_id_arg or (
            str(first_user.id) if first_user else "93c0700a-423f-42eb-8c91-0b90f300ca11"
        )
        ctx = _resolve_or_create_draft(
            session=session, user_id=user_id, platform=platform_arg
        )

    _display_step_1_context(ctx=ctx)

    with Session(db_engine) as session:
        _display_step_2_accounts(user_id=user_id, session=session)

    start_time = time.time()
    try:
        with Session(db_engine) as session:
            report = await publish_post_with_graph(
                user_id=user_id,
                post_id=ctx.post_id,
                platform=ctx.platform,
                headless=False,
                session=session,
            )
        duration = round(time.time() - start_time, 2)
        _display_step_3_and_4_results(report=report, duration=duration)

        with Session(db_engine) as session:
            _verify_database_record(session=session, post_id=ctx.post_id)
    except Exception as exc:
        print(f"\n❌ PostingGraph demo failed with exception: {exc}")


if __name__ == "__main__":
    asyncio.run(main())
