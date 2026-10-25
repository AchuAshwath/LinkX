"""One local feature task, retained through cancellation and provider cleanup."""

import asyncio
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.observation.schemas import OperationStatus


class LaneBusy(Exception):
    """An invocation is active or this operation has already settled."""


@dataclass(frozen=True)
class InvocationRequest:
    owner_id: UUID
    operation_id: UUID
    timeout_seconds: float


@dataclass
class Invocation:
    request: InvocationRequest
    task: asyncio.Task[Any] | None = None
    cancelled: bool = False


class FeatureBroker:
    def __init__(self, *, max_receipts: int = 32, receipt_ttl: float = 300) -> None:
        self._active: Invocation | None = None
        self._receipts: OrderedDict[UUID, tuple[UUID, float, bool]] = OrderedDict()
        self._max_receipts = max_receipts
        self._receipt_ttl = receipt_ttl

    @property
    def busy(self) -> bool:
        return self._active is not None

    def start(
        self,
        *,
        request: InvocationRequest,
        work: Callable[[Invocation], Awaitable[Any]],
    ) -> Invocation:
        self._prune()
        if self._active is not None or request.operation_id in self._receipts:
            raise LaneBusy(
                "Browser processing is active or this operation already settled"
            )
        invocation = Invocation(request=request)
        self._active = invocation
        invocation.task = asyncio.create_task(
            self._run(invocation=invocation, work=work)
        )
        invocation.task.add_done_callback(_observe_completion)
        return invocation

    def check_available(self, *, operation_id: UUID) -> None:
        self._prune()
        if self._active is not None or operation_id in self._receipts:
            raise LaneBusy(
                "Browser processing is active or this operation already settled"
            )

    async def _run(
        self, *, invocation: Invocation, work: Callable[[Invocation], Awaitable[Any]]
    ) -> Any:
        try:
            async with asyncio.timeout(invocation.request.timeout_seconds):
                return await work(invocation)
        finally:
            request = invocation.request
            self._receipts[request.operation_id] = (
                request.owner_id,
                time.monotonic(),
                invocation.cancelled,
            )
            self._active = None
            self._prune()

    def status(self, *, owner_id: UUID, operation_id: UUID) -> OperationStatus:
        self._prune()
        active = self._active
        if active is not None and active.request.operation_id == operation_id:
            if active.request.owner_id == owner_id:
                return OperationStatus(
                    operation_id=operation_id,
                    state="active",
                    cancelled=active.cancelled,
                )
        receipt = self._receipts.get(operation_id)
        if receipt is not None and receipt[0] == owner_id:
            return OperationStatus(
                operation_id=operation_id, state="settled", cancelled=receipt[2]
            )
        return OperationStatus(operation_id=operation_id, state="unknown")

    def cancel(self, *, owner_id: UUID, operation_id: UUID) -> OperationStatus:
        active = self._active
        if active is not None and active.request.operation_id == operation_id:
            if active.request.owner_id == owner_id:
                active.cancelled = True
        return self.status(owner_id=owner_id, operation_id=operation_id)

    def _prune(self) -> None:
        now = time.monotonic()
        expired = [
            key
            for key, value in self._receipts.items()
            if now - value[1] > self._receipt_ttl
        ]
        for key in expired:
            del self._receipts[key]
        while len(self._receipts) > self._max_receipts:
            self._receipts.popitem(last=False)


feature_broker = FeatureBroker()


def _observe_completion(task: asyncio.Task[Any]) -> None:
    if not task.cancelled():
        task.exception()
