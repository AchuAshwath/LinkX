from app.services.ai_stream_turn import StreamTurn, replay_stream_parts


def test_stream_turn_keeps_ordinary_parts_and_excludes_browser_payloads() -> None:
    turn = StreamTurn()
    turn.record("text_delta", {"content": "Hello "})
    turn.record("browser_note", {"text": "temporary note"})
    turn.record(
        "tool_start",
        {"id": "read-1", "name": "read_browser_context", "input": {}},
    )
    turn.record(
        "tool_output",
        {
            "id": "read-1",
            "name": "read_browser_context",
            "output": {"note": "temporary note"},
        },
    )
    turn.record(
        "tool_start",
        {"id": "search-1", "name": "search_trends", "input": {"query": "AI"}},
    )
    turn.record(
        "tool_output",
        {
            "id": "search-1",
            "name": "search_trends",
            "output": {"items": ["one"]},
        },
    )
    turn.record("text_delta", {"content": "world"})

    assert turn.text == "Hello world"
    assert turn.has_visible_output
    assert turn.parts_snapshot() == [
        {"type": "text", "text": "Hello "},
        {
            "type": "tool-call",
            "toolCallId": "search-1",
            "name": "search_trends",
            "state": "completed",
            "tool": {
                "id": "search-1",
                "name": "search_trends",
                "state": "completed",
                "input": {"query": "AI"},
                "output": {"items": ["one"]},
            },
            "output": {"items": ["one"]},
        },
        {"type": "text", "text": "world"},
    ]


def test_stream_turn_ignores_thought_and_marks_running_tools_on_interruption() -> None:
    turn = StreamTurn()
    turn.record("thought", {"content": "internal reasoning"})
    turn.record("tool_start", {"id": "lookup-1", "name": "search_trends"})

    assert len(turn.parts_snapshot()) == 1
    assert turn.parts_snapshot()[0]["type"] == "tool-call"
    assert turn.has_visible_output

    turn.record("text_delta", {"content": "Partial answer."})
    terminal = turn.terminal_parts(interrupted=True)
    assert terminal[0] == {
        "type": "tool-call",
        "toolCallId": "lookup-1",
        "name": "search_trends",
        "state": "cancelled",
        "tool": {
            "id": "lookup-1",
            "name": "search_trends",
            "state": "cancelled",
            "input": {},
            "output": None,
        },
    }
    assert terminal[1] == {"type": "text", "text": "Partial answer."}
    assert turn.parts_snapshot()[0]["state"] == "running"


def test_stream_turn_accepts_only_explicit_thought_summaries() -> None:
    turn = StreamTurn(allow_thought_summary=True)
    turn.record("thought", {"content": "Approved progress summary."})

    assert turn.has_visible_output
    assert turn.parts_snapshot() == [
        {"type": "thought", "content": "Approved progress summary."}
    ]


def test_stream_turn_redacts_nested_browser_payloads_from_ordinary_tool_output() -> (
    None
):
    turn = StreamTurn()
    turn.record(
        "tool_output",
        {
            "id": "artifact-1",
            "name": "create_report",
            "output": {
                "metadata": {
                    "browser_context": {"notes": ["private page note"]},
                    "image_data_url": "data:image/jpeg;base64,PRIVATE_IMAGE",
                    "browser_memory": "private capture state",
                },
                "safe": "The report was saved.",
                "log": "Preview data:image/png;base64,YWJj",
                "artifact": {"notes": "Ordinary report notes remain."},
            },
        },
    )

    assert turn.parts_snapshot() == [
        {
            "type": "tool-call",
            "toolCallId": "artifact-1",
            "name": "create_report",
            "state": "completed",
            "tool": {
                "id": "artifact-1",
                "name": "create_report",
                "state": "completed",
                "input": {},
                "output": {
                    "metadata": {},
                    "safe": "The report was saved.",
                    "log": "Preview [redacted image data]",
                    "artifact": {"notes": "Ordinary report notes remain."},
                },
            },
        }
    ]


def test_replay_sanitizes_raw_imported_parts_before_emitting_events() -> None:
    replayed = list(
        replay_stream_parts(
            parts=[
                {
                    "type": "tool-call",
                    "toolCallId": "legacy-1",
                    "name": "create_report",
                    "state": "completed",
                    "tool": {
                        "input": {},
                        "output": {
                            "metadata": {
                                "browser_context": {"secret": "PRIVATE_NOTE"},
                                "image_data_url": "data:image/jpeg;base64,PRIVATE_IMAGE",
                                "browser_memory": "PRIVATE_MEMORY",
                            },
                            "safe": "Artifact remains available.",
                            "notes": "Ordinary notes remain available.",
                        },
                    },
                    "output": {
                        "metadata": {},
                        "safe": "Artifact remains available.",
                        "notes": "Ordinary notes remain available.",
                    },
                }
            ]
        )
    )

    assert replayed == [
        (
            "tool_start",
            {"id": "legacy-1", "name": "create_report", "input": {}},
        ),
        (
            "tool_output",
            {
                "id": "legacy-1",
                "name": "create_report",
                "output": {
                    "metadata": {},
                    "safe": "Artifact remains available.",
                    "notes": "Ordinary notes remain available.",
                },
            },
        ),
    ]
