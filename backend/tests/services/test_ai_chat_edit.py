import uuid
from typing import Any
from unittest.mock import MagicMock

from app.models import ChatThread, ChatThreadUpdate
from app.services.ai_turn_accumulator import (
    TranscriptEditPayload,
    apply_transcript_branch,
    ensure_parent_ids,
    find_deepest_leaf,
    find_sibling_branches,
    resolve_active_branch,
)


def test_ensure_parent_ids_backfills_linear_chain() -> None:
    legacy_messages = [
        {"id": "msg_1", "role": "user", "parts": [{"type": "text", "text": "A"}]},
        {"id": "msg_2", "role": "assistant", "parts": [{"type": "text", "text": "B"}]},
        {"id": "msg_3", "role": "user", "parts": [{"type": "text", "text": "C"}]},
    ]
    normalized = ensure_parent_ids(messages=legacy_messages)
    assert normalized[0]["parent_id"] is None
    assert normalized[1]["parent_id"] == "msg_1"
    assert normalized[2]["parent_id"] == "msg_2"


def test_ensure_parent_ids_heals_explicit_none_parent_ids() -> None:
    """Ensure older DB messages with explicit parent_id=None are healed sequentially."""
    db_messages = [
        {"id": "msg_1", "parent_id": None, "role": "user"},
        {"id": "msg_2", "parent_id": None, "role": "assistant"},
        {"id": "msg_3", "parent_id": None, "role": "user"},
    ]
    normalized = ensure_parent_ids(messages=db_messages)
    assert normalized[0]["parent_id"] is None
    assert normalized[1]["parent_id"] == "msg_1"
    assert normalized[2]["parent_id"] == "msg_2"


def test_resolve_active_branch_walks_backward_to_root() -> None:
    # Tree structure:
    # msg_u1 (root) -> msg_a1 -> msg_u2a -> msg_a2a
    #                       \-> msg_u2b -> msg_a2b
    messages = [
        {"id": "msg_u1", "parent_id": None, "role": "user"},
        {"id": "msg_a1", "parent_id": "msg_u1", "role": "assistant"},
        {"id": "msg_u2a", "parent_id": "msg_a1", "role": "user"},
        {"id": "msg_a2a", "parent_id": "msg_u2a", "role": "assistant"},
        {"id": "msg_u2b", "parent_id": "msg_a1", "role": "user"},
        {"id": "msg_a2b", "parent_id": "msg_u2b", "role": "assistant"},
    ]

    # Resolve Branch A
    path_a = resolve_active_branch(messages=messages, active_leaf_id="msg_a2a")
    assert [m["id"] for m in path_a] == ["msg_u1", "msg_a1", "msg_u2a", "msg_a2a"]

    # Resolve Branch B
    path_b = resolve_active_branch(messages=messages, active_leaf_id="msg_a2b")
    assert [m["id"] for m in path_b] == ["msg_u1", "msg_a1", "msg_u2b", "msg_a2b"]


def test_find_sibling_branches_detects_forks() -> None:
    messages = [
        {"id": "msg_u1", "parent_id": None, "role": "user"},
        {"id": "msg_a1", "parent_id": "msg_u1", "role": "assistant"},
        {"id": "msg_u2a", "parent_id": "msg_a1", "role": "user"},
        {"id": "msg_u2b", "parent_id": "msg_a1", "role": "user"},
    ]
    siblings = find_sibling_branches(messages=messages, message_id="msg_u2a")
    assert len(siblings) == 2
    assert [s["id"] for s in siblings] == ["msg_u2a", "msg_u2b"]


def test_find_deepest_leaf_follows_latest_children() -> None:
    messages = [
        {"id": "msg_u1", "parent_id": None, "role": "user"},
        {"id": "msg_a1", "parent_id": "msg_u1", "role": "assistant"},
        {"id": "msg_u2a", "parent_id": "msg_a1", "role": "user"},
        {"id": "msg_a2a", "parent_id": "msg_u2a", "role": "assistant"},
    ]
    leaf = find_deepest_leaf(messages=messages, node_id="msg_u1")
    assert leaf == "msg_a2a"


def test_apply_transcript_branch_user_message_creates_sibling_and_preserves_old() -> (
    None
):
    session = MagicMock()
    thread = MagicMock()
    thread.active_leaf_id = "msg_asst_2"
    thread.transcript = {
        "messages": [
            {
                "id": "msg_user_1",
                "parent_id": None,
                "role": "user",
                "parts": [{"type": "text", "text": "Draft an AI post"}],
            },
            {
                "id": "msg_asst_1",
                "parent_id": "msg_user_1",
                "role": "assistant",
                "parts": [{"type": "text", "text": "Here is an AI post..."}],
            },
            {
                "id": "msg_user_2",
                "parent_id": "msg_asst_1",
                "role": "user",
                "parts": [{"type": "text", "text": "Make it shorter"}],
            },
            {
                "id": "msg_asst_2",
                "parent_id": "msg_user_2",
                "role": "assistant",
                "parts": [{"type": "text", "text": "Shorter version..."}],
            },
        ]
    }

    payload = TranscriptEditPayload(
        edit_message_id="msg_user_2",
        message_text="Make it about Rust instead",
        clean_images=["data:image/png;base64,abc"],
    )

    success = apply_transcript_branch(
        session=session,
        thread=thread,
        payload=payload,
    )

    assert success is True
    # Non-destructive: total messages grew from 4 to 5 (old turns preserved!)
    assert len(thread.transcript["messages"]) == 5
    assert thread.message_count == 5

    # New message is a sibling with parent_id == msg_asst_1
    new_msg = thread.transcript["messages"][-1]
    assert new_msg["parent_id"] == "msg_asst_1"
    assert new_msg["role"] == "user"
    assert new_msg["parts"][0]["text"] == "Make it about Rust instead"
    assert thread.active_leaf_id == new_msg["id"]
    session.commit.assert_called_once()


def test_apply_transcript_branch_assistant_turn_regenerate_sets_leaf_to_parent() -> (
    None
):
    session = MagicMock()
    thread = MagicMock()
    thread.active_leaf_id = "msg_asst_1"
    thread.transcript = {
        "messages": [
            {
                "id": "msg_user_1",
                "parent_id": None,
                "role": "user",
                "parts": [{"type": "text", "text": "Hello"}],
            },
            {
                "id": "msg_asst_1",
                "parent_id": "msg_user_1",
                "role": "assistant",
                "parts": [{"type": "text", "text": "Failed or bad response"}],
            },
        ]
    }

    payload = TranscriptEditPayload(
        edit_message_id="msg_asst_1",
        message_text="Hello",
        clean_images=[],
    )

    success = apply_transcript_branch(
        session=session,
        thread=thread,
        payload=payload,
    )

    assert success is True
    # Non-destructive: old assistant message preserved!
    assert len(thread.transcript["messages"]) == 2
    # Active leaf moved back to parent user prompt
    assert thread.active_leaf_id == "msg_user_1"
    assert thread.transcript["active_leaf_id"] == "msg_user_1"


def test_apply_transcript_branch_missing_message_returns_false() -> None:
    session = MagicMock()
    thread = MagicMock()
    thread.transcript = {"messages": [{"id": "msg_1", "role": "user", "parts": []}]}

    payload = TranscriptEditPayload(
        edit_message_id="non_existent_id",
        message_text="New text",
        clean_images=[],
    )

    success = apply_transcript_branch(
        session=session,
        thread=thread,
        payload=payload,
    )

    assert success is False
    session.commit.assert_not_called()


def test_crud_update_chat_thread_sets_is_custom_title_and_active_leaf() -> None:
    from app import crud

    session = MagicMock()
    db_thread = ChatThread(
        id=uuid.uuid4(),
        owner_id=uuid.uuid4(),
        title="Original Auto Title",
        origin="manual",
        is_custom_title=False,
    )

    update_in = ChatThreadUpdate(
        title="My Custom Title",
        active_leaf_id="msg_leaf_42",
    )
    updated = crud.update_chat_thread(
        session=session,
        db_thread=db_thread,
        thread_in=update_in,
    )

    assert updated.title == "My Custom Title"
    assert updated.is_custom_title is True
    assert updated.active_leaf_id == "msg_leaf_42"


def test_append_stream_part_updates_draft_artifact_in_place() -> None:
    from app.services.ai_turn_accumulator import append_stream_part

    parts: list[dict[str, Any]] = []
    append_stream_part(
        parts,
        event="draft_artifact",
        data={"post_id": "p-100", "content": "Initial draft content"},
    )
    assert len(parts) == 1
    assert parts[0]["content"] == "Initial draft content"

    # Second draft_artifact event for the same post_id should replace in place
    append_stream_part(
        parts,
        event="draft_artifact",
        data={"post_id": "p-100", "content": "Refined meaner content"},
    )
    assert len(parts) == 1
    assert parts[0]["content"] == "Refined meaner content"


def test_append_or_update_draft_part_updates_in_place() -> None:
    from app.services.ai_turn_accumulator import append_or_update_draft_part

    assistant_parts: list[dict[str, Any]] = []
    append_or_update_draft_part(
        assistant_parts,
        payload={"post_id": "p-200", "content": "Draft v1", "platform": "x"},
    )
    assert len(assistant_parts) == 1
    assert assistant_parts[0]["content"] == "Draft v1"

    append_or_update_draft_part(
        assistant_parts,
        payload={"post_id": "p-200", "content": "Draft v2 updated", "platform": "x"},
    )
    assert len(assistant_parts) == 1
    assert assistant_parts[0]["content"] == "Draft v2 updated"


def _to_langchain_messages(*, path: list[dict[str, Any]], sys_prompt: Any) -> list[Any]:
    from langchain_core.messages import AIMessage, HumanMessage

    lc_msgs: list[Any] = [sys_prompt]
    for m in path:
        text = str(m["parts"][0]["text"])
        cls = HumanMessage if m["role"] == "user" else AIMessage
        lc_msgs.append(cls(content=text))
    return lc_msgs


def test_token_budgeting_on_branched_transcript() -> None:
    """Verify that context window token budgeting strictly operates on the active branch."""
    from langchain_core.messages import SystemMessage

    from app.services.ai_context_budgeter import (
        apply_sliding_window_budget,
        estimate_total_tokens,
    )

    messages = [
        {
            "id": "msg_u1",
            "parent_id": None,
            "role": "user",
            "parts": [{"type": "text", "text": "Hello world"}],
        },
        {
            "id": "msg_a1",
            "parent_id": "msg_u1",
            "role": "assistant",
            "parts": [{"type": "text", "text": "Welcome to LinkX"}],
        },
        {
            "id": "msg_u2a",
            "parent_id": "msg_a1",
            "role": "user",
            "parts": [{"type": "text", "text": "Branch A request: write an essay"}],
        },
        {
            "id": "msg_a2a",
            "parent_id": "msg_u2a",
            "role": "assistant",
            "parts": [{"type": "text", "text": "X" * 15000}],
        },
        {
            "id": "msg_u2b",
            "parent_id": "msg_a1",
            "role": "user",
            "parts": [{"type": "text", "text": "Branch B request: short answer"}],
        },
        {
            "id": "msg_a2b",
            "parent_id": "msg_u2b",
            "role": "assistant",
            "parts": [{"type": "text", "text": "Short answer here"}],
        },
    ]

    # Resolve Branch B path
    active_path_b = resolve_active_branch(messages=messages, active_leaf_id="msg_a2b")
    branch_b_ids = [m["id"] for m in active_path_b]
    assert "msg_a2a" not in branch_b_ids
    assert "msg_u2a" not in branch_b_ids
    assert branch_b_ids == ["msg_u1", "msg_a1", "msg_u2b", "msg_a2b"]

    sys_prompt = SystemMessage(content="You are a helpful assistant.")
    lc_messages_b = _to_langchain_messages(path=active_path_b, sys_prompt=sys_prompt)
    budgeted_b = apply_sliding_window_budget(lc_messages_b, token_budget=500)
    assert len(budgeted_b) == 5
    assert estimate_total_tokens(budgeted_b) < 100

    # Branch A's massive message forces sliding window truncation
    active_path_a = resolve_active_branch(messages=messages, active_leaf_id="msg_a2a")
    lc_messages_a = _to_langchain_messages(path=active_path_a, sys_prompt=sys_prompt)
    budgeted_a = apply_sliding_window_budget(lc_messages_a, token_budget=500)
    assert len(budgeted_a) < len(lc_messages_a)
    assert len(budgeted_a) == 2
