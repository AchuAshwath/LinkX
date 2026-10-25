"""Ownership checks and short admission guard shared by chat routes."""

import uuid

from fastapi import HTTPException

from app.observation.thread_guard import thread_guard


def claim_thread(*, thread_id: uuid.UUID, token: str) -> None:
    if not thread_guard.acquire(thread_id=thread_id, token=token):
        raise HTTPException(
            status_code=409, detail="This chat already has an active request"
        )
