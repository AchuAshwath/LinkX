import uuid
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlmodel import Session, select

from app.core.db import engine
from app.models import ChatThread, User
from app.observation.persistence import (
    CompletionPayload,
    TranscriptTurnRequest,
    begin_transcript_turn,
    complete_transcript_turn,
)
from app.observation.thread_guard import ThreadBusyError, ThreadGuard


@pytest.fixture
def committed_thread() -> Generator[ChatThread, None, None]:
    if engine.dialect.name != "postgresql":
        pytest.skip("row-lock persistence tests require PostgreSQL")
    with Session(engine) as session:
        owner = session.exec(select(User).limit(1)).first()
        assert owner is not None
        thread = ChatThread(owner_id=owner.id, title="Persistence fixture")
        session.add(thread)
        session.commit()
        session.refresh(thread)
        thread_id = thread.id
    try:
        yield thread
    finally:
        with Session(engine) as session:
            persisted = session.get(ChatThread, thread_id)
            if persisted is not None:
                session.delete(persisted)
                session.commit()


def request(
    *, thread: ChatThread, request_id: uuid.UUID, text: str
) -> TranscriptTurnRequest:
    return TranscriptTurnRequest(
        thread_id=thread.id,
        request_id=request_id,
        user_text=text,
        model="test-model",
    )


def test_stale_session_refresh_preserves_user_turn_title_and_assistant(
    committed_thread: ChatThread,
) -> None:
    request_data = request(
        thread=committed_thread,
        request_id=uuid.uuid4(),
        text="What does this page show?",
    )
    with (
        Session(engine, expire_on_commit=False) as writer,
        Session(engine, expire_on_commit=False) as stale_writer,
    ):
        stale_writer.get(ChatThread, committed_thread.id)
        started = begin_transcript_turn(session=writer, request=request_data)
        assert started.status == "started"
        assert started.history == []

        with Session(engine) as metadata_writer:
            current = metadata_writer.get(ChatThread, committed_thread.id)
            assert current is not None
            current.title = "Renamed while inference runs"
            metadata_writer.add(current)
            metadata_writer.commit()

        completed = complete_transcript_turn(
            session=stale_writer,
            request=request_data,
            completion=CompletionPayload(
                answer="The page shows a shipping form.",
                cancelled=lambda: False,
            ),
        )

    assert completed.status == "saved"
    with Session(engine) as verify:
        saved = verify.get(ChatThread, committed_thread.id)
        assert saved is not None
        messages = saved.transcript["messages"]
        assert [message["id"] for message in messages] == [
            request_data.user_message_id,
            request_data.assistant_message_id,
        ]
        assert saved.title == "Renamed while inference runs"
        assert saved.active_leaf_id == request_data.assistant_message_id
        assert all(
            "image_url" not in part for message in messages for part in message["parts"]
        )


def test_completed_duplicate_returns_saved_answer_and_pending_duplicate_conflicts(
    committed_thread: ChatThread,
) -> None:
    request_data = request(
        thread=committed_thread,
        request_id=uuid.uuid4(),
        text="Summarize the page.",
    )
    with Session(engine) as session:
        assert (
            begin_transcript_turn(session=session, request=request_data).status
            == "started"
        )
        pending = begin_transcript_turn(session=session, request=request_data)
        assert pending.status == "conflict"
        saved = complete_transcript_turn(
            session=session,
            request=request_data,
            completion=CompletionPayload(
                answer="A checkout page.",
                cancelled=lambda: False,
            ),
        )
        assert saved.status == "saved"

    with Session(engine) as duplicate_session:
        duplicate = begin_transcript_turn(
            session=duplicate_session,
            request=request_data,
        )

    assert duplicate.status == "completed"
    assert duplicate.answer == "A checkout page."
    with Session(engine) as duplicate_completion_session:
        duplicate_completion = complete_transcript_turn(
            session=duplicate_completion_session,
            request=request_data,
            completion=CompletionPayload(
                answer="A second answer must not replace the first.",
                cancelled=lambda: False,
            ),
        )
    assert duplicate_completion.status == "already_completed"
    assert duplicate_completion.answer == "A checkout page."
    changed_message = TranscriptTurnRequest(
        thread_id=request_data.thread_id,
        request_id=request_data.request_id,
        user_text="A different question reused this ID.",
        model=request_data.model,
    )
    with Session(engine) as conflict_session:
        conflict = begin_transcript_turn(
            session=conflict_session,
            request=changed_message,
        )
    assert conflict.status == "conflict"


def test_new_request_can_continue_after_cancelled_user_message(
    committed_thread: ChatThread,
) -> None:
    cancelled_request = request(
        thread=committed_thread,
        request_id=uuid.uuid4(),
        text="First question was interrupted.",
    )
    with Session(engine) as session:
        begin_transcript_turn(session=session, request=cancelled_request)
        complete_transcript_turn(
            session=session,
            request=cancelled_request,
            completion=CompletionPayload(
                answer="Do not save this.",
                cancelled=lambda: True,
            ),
        )

    next_request = request(
        thread=committed_thread,
        request_id=uuid.uuid4(),
        text="A fresh explicit question.",
    )
    with Session(engine) as session:
        result = begin_transcript_turn(session=session, request=next_request)

    assert result.status == "started"
    assert [message["id"] for message in result.history] == [
        cancelled_request.user_message_id
    ]


def test_begin_updates_model_and_auto_titles_an_untitled_thread(
    committed_thread: ChatThread,
) -> None:
    with Session(engine) as setup:
        thread = setup.get(ChatThread, committed_thread.id)
        assert thread is not None
        thread.title = "New conversation"
        thread.model = "old-model"
        setup.add(thread)
        setup.commit()
    request_data = request(
        thread=committed_thread,
        request_id=uuid.uuid4(),
        text="Please summarize the product page.",
    )

    with Session(engine) as session:
        result = begin_transcript_turn(session=session, request=request_data)
    assert result.status == "started"

    with Session(engine) as verify:
        saved = verify.get(ChatThread, committed_thread.id)
        assert saved is not None
        assert saved.model == "test-model"
        assert saved.title != "New conversation"


def test_begin_captures_only_the_active_branch_before_append(
    committed_thread: ChatThread,
) -> None:
    root_id = "legacy-root"
    active_id = "active-branch-leaf"
    sibling_id = "inactive-branch-leaf"
    with Session(engine) as setup:
        thread = setup.get(ChatThread, committed_thread.id)
        assert thread is not None
        thread.transcript = {
            "messages": [
                {
                    "id": root_id,
                    "role": "user",
                    "parts": [{"type": "text", "text": "root"}],
                },
                {
                    "id": active_id,
                    "role": "assistant",
                    "parent_id": root_id,
                    "parts": [{"type": "text", "text": "active answer"}],
                },
                {
                    "id": sibling_id,
                    "role": "assistant",
                    "parent_id": root_id,
                    "parts": [{"type": "text", "text": "sibling answer"}],
                },
            ],
            "active_leaf_id": active_id,
        }
        thread.active_leaf_id = active_id
        thread.message_count = 3
        setup.add(thread)
        setup.commit()

    request_data = request(
        thread=committed_thread,
        request_id=uuid.uuid4(),
        text="Continue this branch.",
    )
    with Session(engine) as session:
        result = begin_transcript_turn(session=session, request=request_data)

    assert [message["id"] for message in result.history] == [root_id, active_id]
    with Session(engine) as verify:
        saved = verify.get(ChatThread, committed_thread.id)
        assert saved is not None
        user_message = saved.transcript["messages"][-1]
        assert user_message["parent_id"] == active_id
        assert saved.active_leaf_id == request_data.user_message_id


def test_completion_conflicts_if_the_active_leaf_moves_during_inference(
    committed_thread: ChatThread,
) -> None:
    request_data = request(
        thread=committed_thread,
        request_id=uuid.uuid4(),
        text="Read this view.",
    )
    with Session(engine) as session:
        begin_transcript_turn(session=session, request=request_data)

    with Session(engine) as navigator:
        thread = navigator.get(ChatThread, committed_thread.id)
        assert thread is not None
        thread.active_leaf_id = "another-branch"
        transcript = dict(thread.transcript)
        transcript["active_leaf_id"] = "another-branch"
        thread.transcript = transcript
        navigator.add(thread)
        navigator.commit()

    with Session(engine) as session:
        result = complete_transcript_turn(
            session=session,
            request=request_data,
            completion=CompletionPayload(
                answer="This must not land on the new branch.",
                cancelled=lambda: False,
            ),
        )

    assert result.status == "conflict"
    with Session(engine) as verify:
        saved = verify.get(ChatThread, committed_thread.id)
        assert saved is not None
        assert all(
            message["id"] != request_data.assistant_message_id
            for message in saved.transcript["messages"]
        )


def test_completion_after_thread_deletion_does_not_recreate_data(
    committed_thread: ChatThread,
) -> None:
    request_data = request(
        thread=committed_thread,
        request_id=uuid.uuid4(),
        text="Read this view.",
    )
    with Session(engine) as session:
        begin_transcript_turn(session=session, request=request_data)
    with Session(engine) as deleter:
        thread = deleter.get(ChatThread, committed_thread.id)
        assert thread is not None
        deleter.delete(thread)
        deleter.commit()

    with Session(engine) as session:
        result = complete_transcript_turn(
            session=session,
            request=request_data,
            completion=CompletionPayload(
                answer="This thread no longer exists.",
                cancelled=lambda: False,
            ),
        )

    assert result.status == "missing"
    with Session(engine) as verify:
        assert verify.get(ChatThread, committed_thread.id) is None


def test_cancelled_completion_does_not_append_assistant(
    committed_thread: ChatThread,
) -> None:
    request_data = request(
        thread=committed_thread,
        request_id=uuid.uuid4(),
        text="Read the page.",
    )
    with Session(engine) as session:
        begin_transcript_turn(session=session, request=request_data)
        result = complete_transcript_turn(
            session=session,
            request=request_data,
            completion=CompletionPayload(
                answer="This answer must not be saved.",
                cancelled=lambda: True,
            ),
        )

    assert result.status == "cancelled"
    with Session(engine) as verify:
        saved = verify.get(ChatThread, committed_thread.id)
        assert saved is not None
        assert [message["id"] for message in saved.transcript["messages"]] == [
            request_data.user_message_id,
        ]


def test_thread_guard_owns_thread_until_matching_token_releases() -> None:
    guard = ThreadGuard()
    thread_id = uuid.uuid4()
    guard.acquire(thread_id=thread_id, token="browser-operation")

    with pytest.raises(ThreadBusyError):
        guard.assert_available(thread_id=thread_id)
    assert not guard.acquire(thread_id=thread_id, token="ordinary-operation")

    guard.assert_available(thread_id=thread_id, token="browser-operation")
    guard.release(thread_id=thread_id, token="wrong-token")
    guard.assert_available(thread_id=thread_id, token="browser-operation")
    guard.release(thread_id=thread_id, token="browser-operation")
    guard.assert_available(thread_id=thread_id)


def test_thread_guard_admits_only_one_concurrent_owner() -> None:
    guard = ThreadGuard()
    thread_id = uuid.uuid4()
    barrier = Barrier(8)

    def attempt(index: int) -> bool:
        barrier.wait()
        return guard.acquire(thread_id=thread_id, token=f"operation-{index}")

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(attempt, range(8)))

    assert sum(results) == 1
