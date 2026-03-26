from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlmodel import col, func, select

from app.api.deps import SessionDep, get_current_active_superuser
from app.models import Post

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(get_current_active_superuser)],
)


@router.get("/scheduler/status")
def read_scheduler_status(*, session: SessionDep) -> Any:
    now = datetime.now(timezone.utc)

    total_posts = session.exec(select(func.count()).select_from(Post)).one()

    by_status_rows = session.exec(
        select(Post.status, func.count()).group_by(Post.status)
    ).all()
    by_status = dict(by_status_rows)

    due_scheduled = session.exec(
        select(func.count())
        .select_from(Post)
        .where(
            Post.status == "scheduled",
            col(Post.scheduled_at).is_not(None),
            col(Post.scheduled_at) <= now,
        )
    ).one()

    due_retries = session.exec(
        select(func.count())
        .select_from(Post)
        .where(
            col(Post.next_retry_at).is_not(None),
            col(Post.next_retry_at) <= now,
        )
    ).one()

    failed_recent = session.exec(
        select(Post)
        .where(Post.status == "failed")
        .order_by(col(Post.updated_at).desc().nulls_last())
        .limit(10)
    ).all()

    return {
        "now": now.isoformat(),
        "total_posts": total_posts,
        "by_status": by_status,
        "due_scheduled": due_scheduled,
        "due_retries": due_retries,
        "recent_failures": [
            {
                "id": str(p.id),
                "persona_id": str(p.persona_id) if p.persona_id else None,
                "platform": p.platform,
                "retry_count": p.retry_count,
                "error_code": p.error_code,
                "error_message": p.error_message,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            }
            for p in failed_recent
        ],
    }
