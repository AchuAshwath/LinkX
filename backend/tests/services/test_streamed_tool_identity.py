from app.services.ai_stream_turn import StreamTurn


def test_tool_outputs_update_calls_by_id_when_names_repeat():
    turn = StreamTurn()
    turn.record("tool_start", {"id": "call-1", "name": "search", "input": {"q": "one"}})
    turn.record("tool_start", {"id": "call-2", "name": "search", "input": {"q": "two"}})

    turn.record(
        "tool_output", {"id": "call-1", "name": "search", "output": "result one"}
    )
    after_first = turn.parts_snapshot()

    assert after_first[0]["toolCallId"] == "call-1"
    assert after_first[0]["state"] == "completed"
    assert after_first[0]["output"] == "result one"
    assert after_first[1]["toolCallId"] == "call-2"
    assert after_first[1]["state"] == "running"
    assert "output" not in after_first[1]
    assert after_first[1]["tool"]["output"] is None

    turn.record(
        "tool_output", {"id": "call-2", "name": "search", "output": "result two"}
    )
    final = turn.parts_snapshot()

    assert [part["output"] for part in final] == ["result one", "result two"]
    assert [part["state"] for part in final] == ["completed", "completed"]


def test_tool_output_without_id_retains_legacy_name_matching():
    turn = StreamTurn()
    turn.record("tool_start", {"id": "call-legacy", "name": "lookup", "input": {}})

    turn.record("tool_output", {"name": "lookup", "output": "legacy result"})

    parts = turn.parts_snapshot()
    assert len(parts) == 1
    assert parts[0]["toolCallId"] == "call-legacy"
    assert parts[0]["state"] == "completed"
    assert parts[0]["output"] == "legacy result"
