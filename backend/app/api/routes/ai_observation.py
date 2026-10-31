"""Authenticated stateless background browser reading operations."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar, cast
from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.api.deps import CurrentUser
from app.observation.broker import (
    Invocation,
    InvocationRequest,
    LaneBusy,
    feature_broker,
)
from app.observation.model import BrowserModel, ObservationModelError
from app.observation.schemas import (
    CompactRequest,
    CompactResponse,
    OperationStatus,
    ReadRequest,
    ReadResponse,
)
from app.services.ai_observation_budget import ObservationInputBudgetError

T = TypeVar("T")

router = APIRouter(prefix="/ai/observation", tags=["ai-observation"])
browser_model = BrowserModel()


@router.post("/read", response_model=ReadResponse)
async def read_browser(*, current_user: CurrentUser, body: ReadRequest) -> ReadResponse:
    async def work(invocation: Invocation) -> ReadResponse:
        note = await browser_model.read(request=body)
        if invocation.cancelled:
            raise ObservationModelError("Browser operation was stopped")
        return ReadResponse(operation_id=body.operation_id, note=note)

    return await _invoke(
        owner_id=current_user.id, operation_id=body.operation_id, work=work
    )


@router.post("/compact", response_model=CompactResponse)
async def compact_browser(
    *, current_user: CurrentUser, body: CompactRequest
) -> CompactResponse:
    async def work(invocation: Invocation) -> CompactResponse:
        summary = await browser_model.compact(request=body)
        if invocation.cancelled:
            raise ObservationModelError("Browser operation was stopped")
        return CompactResponse(operation_id=body.operation_id, summary=summary)

    return await _invoke(
        owner_id=current_user.id, operation_id=body.operation_id, work=work
    )


async def _invoke(
    *, owner_id: UUID, operation_id: UUID, work: Callable[[Invocation], Awaitable[T]]
) -> T:
    invocation = _start_invocation(
        owner_id=owner_id, operation_id=operation_id, work=work
    )
    try:
        task = invocation.task
        assert task is not None
        return cast(T, await asyncio.shield(task))
    except asyncio.CancelledError:
        feature_broker.cancel(owner_id=owner_id, operation_id=operation_id)
        raise
    except ObservationInputBudgetError:
        raise HTTPException(
            status_code=422, detail="Selected model cannot fit browser input"
        ) from None
    except (ObservationModelError, TimeoutError):
        raise HTTPException(
            status_code=502, detail="Browser processing failed or timed out"
        ) from None


@router.get("/operations/{id}", response_model=OperationStatus)
async def operation_status(*, current_user: CurrentUser, id: UUID) -> OperationStatus:
    return feature_broker.status(owner_id=current_user.id, operation_id=id)


@router.delete("/operations/{id}", response_model=OperationStatus)
async def cancel_operation(*, current_user: CurrentUser, id: UUID) -> OperationStatus:
    return feature_broker.cancel(owner_id=current_user.id, operation_id=id)


def _start_invocation(
    *, owner_id: UUID, operation_id: UUID, work: Callable[[Invocation], Awaitable[T]]
) -> Invocation:
    try:
        return feature_broker.start(
            request=InvocationRequest(owner_id, operation_id, 45), work=work
        )
    except LaneBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
