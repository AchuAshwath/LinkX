import asyncio
from uuid import uuid4

import pytest

from app.observation.broker import FeatureBroker, InvocationRequest, LaneBusy


@pytest.mark.anyio
async def test_cancel_keeps_physical_lane_until_cleanup():
    broker = FeatureBroker()
    owner, operation = uuid4(), uuid4()
    entered, release = asyncio.Event(), asyncio.Event()

    async def work(invocation):
        entered.set()
        await release.wait()
        return not invocation.cancelled

    invocation = broker.start(request=InvocationRequest(owner, operation, 1), work=work)
    await entered.wait()
    broker.cancel(owner_id=owner, operation_id=operation)
    with pytest.raises(LaneBusy):
        broker.start(request=InvocationRequest(owner, uuid4(), 1), work=work)
    assert broker.status(owner_id=uuid4(), operation_id=operation).state == "unknown"
    release.set()
    assert await invocation.task is False
    await asyncio.sleep(0)
    assert broker.status(owner_id=owner, operation_id=operation).state == "settled"
    next_invocation = broker.start(
        request=InvocationRequest(owner, uuid4(), 1), work=work
    )
    assert await next_invocation.task is True


@pytest.mark.anyio
async def test_receipts_are_bounded_metadata_and_duplicates_never_reexecute():
    broker = FeatureBroker(max_receipts=2)
    owner = uuid4()
    ids = [uuid4() for _ in range(3)]

    async def work(_invocation):
        return "private result"

    for operation in ids:
        invocation = broker.start(
            request=InvocationRequest(owner, operation, 1), work=work
        )
        assert await invocation.task == "private result"
        await asyncio.sleep(0)
    assert broker.status(owner_id=owner, operation_id=ids[0]).state == "unknown"
    with pytest.raises(LaneBusy):
        broker.start(request=InvocationRequest(owner, ids[-1], 1), work=work)
    assert (
        "private result"
        not in broker.status(owner_id=owner, operation_id=ids[-1]).model_dump_json()
    )
