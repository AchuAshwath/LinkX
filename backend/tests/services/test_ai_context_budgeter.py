from unittest.mock import patch

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from app.services.ai_chat_runner import LINKX_SYSTEM_PROMPT
from app.services.ai_context_budgeter import (
    TOOL_TRUNCATION_NOTICE,
    apply_sliding_window_budget,
    count_tokens,
    estimate_message_tokens,
    estimate_total_tokens,
    prune_tool_call_outputs,
)


def test_count_tokens_tiktoken_and_fallback() -> None:
    """Issue #119: Verify count_tokens with tiktoken and character ratio fallback."""
    assert count_tokens(text="") == 0
    token_count = count_tokens(text="Hello world, this is a test prompt for LinkX.")
    assert token_count > 0

    with patch("tiktoken.encoding_for_model", side_effect=Exception("Encoding error")):
        with patch("tiktoken.get_encoding", side_effect=Exception("No encoding")):
            fallback_count = count_tokens(text="Short sentence for test.")
            assert fallback_count == len("Short sentence for test.") // 4


def test_count_tokens_exact_accuracy() -> None:
    """Issue #119: Validate exact token counts against direct tiktoken model encoding."""
    import tiktoken

    enc = tiktoken.encoding_for_model("gpt-4o")
    text = "LinkX Bot crafts engaging posts for founders."
    expected = len(enc.encode(text))
    assert count_tokens(text=text, model="gpt-4o") == expected


def test_estimate_message_tokens_multimodal() -> None:
    """Issue #119: Verify estimation for text and multimodal content."""
    text_msg = HumanMessage(content="Simple user query")
    tokens = estimate_message_tokens(message=text_msg)
    assert tokens >= 4

    multi_msg = HumanMessage(
        content=[
            {"type": "text", "text": "Check this screenshot"},
            {"type": "image_url", "image_url": {"url": "https://example.com/img.png"}},
        ]
    )
    multi_tokens = estimate_message_tokens(message=multi_msg)
    # Should include 1000 standard vision overhead for the image_url plus text tokens
    assert multi_tokens >= 1004


def test_estimate_total_tokens() -> None:
    """Issue #119: Verify total token summation across multiple messages."""
    msgs: list[BaseMessage] = [
        SystemMessage(content=LINKX_SYSTEM_PROMPT),
        HumanMessage(content="First message"),
        AIMessage(content="First response"),
    ]
    total = estimate_total_tokens(messages=msgs)
    individual_sum = sum(estimate_message_tokens(message=m) for m in msgs)
    assert total == individual_sum
    assert total > 0


def test_prune_tool_call_outputs_truncates_large_payloads() -> None:
    """Issue #119: Verify pruning large tool outputs exceeding max_chars."""
    assert prune_tool_call_outputs(transcript=None) is None

    long_output = "x" * 500
    short_output = "Short tool result"
    transcript = {
        "messages": [
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "tool_call",
                        "name": "generate_post",
                        "output": long_output,
                        "tool": {"output": long_output},
                    },
                    {
                        "type": "tool-call",
                        "name": "check_status",
                        "output": short_output,
                    },
                ],
            }
        ]
    }
    pruned = prune_tool_call_outputs(
        transcript=transcript, max_chars=300, recent_turns_intact=0
    )
    assert pruned is not None
    pruned_parts = pruned["messages"][0]["parts"]
    assert pruned_parts[0]["output"] == TOOL_TRUNCATION_NOTICE
    assert pruned_parts[0]["tool"]["output"] == TOOL_TRUNCATION_NOTICE
    assert pruned_parts[1]["output"] == short_output


def test_apply_sliding_window_budget_preserves_system_and_latest() -> None:
    """Issue #119: Verify sliding window drops older turns while preserving system & latest."""
    sys_msg = SystemMessage(content="You are an assistant")
    turns = [
        HumanMessage(
            content=f"User question {i} with some long text to increase tokens"
        )
        if i % 2 == 0
        else AIMessage(content=f"Assistant reply {i} with long detailed explanations")
        for i in range(10)
    ]
    all_msgs: list[BaseMessage] = [sys_msg, *turns]

    # Window with generous budget returns all
    unbounded = apply_sliding_window_budget(messages=all_msgs, token_budget=10000)
    assert len(unbounded) == 11

    # Extremely constrained budget keeps system message and latest message
    constrained = apply_sliding_window_budget(messages=all_msgs, token_budget=20)
    assert len(constrained) == 2
    assert constrained[0] == sys_msg
    assert constrained[-1] == turns[-2]  # Latest HumanMessage


def test_historical_tool_output_pruning_preserves_recent_prunes_older() -> None:
    """Issue #119: Turns older than latest 3 turns have heavy scrape outputs collapsed, while recent turns remain intact."""
    heavy_tweets = [{"id": i, "text": f"Tweet {i} " * 20} for i in range(20)]
    transcript = {
        "messages": [
            # Turn 1 (Oldest user turn + assistant scrape)
            {"role": "user", "parts": [{"type": "text", "text": "Turn 1 user"}]},
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "tool_call",
                        "name": "scrape_tool",
                        "output": {"tweets": heavy_tweets, "status": "success"},
                    }
                ],
            },
            # Turn 2 (Historical user turn + scrape trends)
            {"role": "user", "parts": [{"type": "text", "text": "Turn 2 user"}]},
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "tool_call",
                        "name": "scrape_trends",
                        "output": {
                            "topics_scraped": ["AI", "Tech"],
                            "grok_summary": "Summary of AI trends",
                            "status": "success",
                        },
                    }
                ],
            },
            # Turn 3 (Recent turn 1 of 3)
            {"role": "user", "parts": [{"type": "text", "text": "Turn 3 user"}]},
            {
                "role": "assistant",
                "parts": [{"type": "text", "text": "Turn 3 assistant"}],
            },
            # Turn 4 (Recent turn 2 of 3 with heavy tweets - MUST NOT be pruned!)
            {"role": "user", "parts": [{"type": "text", "text": "Turn 4 user"}]},
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "tool_call",
                        "name": "scrape_tool",
                        "output": {"tweets": heavy_tweets, "status": "success"},
                    }
                ],
            },
            # Turn 5 (Most recent turn 3 of 3)
            {"role": "user", "parts": [{"type": "text", "text": "Turn 5 user"}]},
        ]
    }

    pruned = prune_tool_call_outputs(transcript=transcript, recent_turns_intact=3)
    assert pruned is not None
    msgs = pruned["messages"]

    # Turn 1 (older than latest 3 turns) should be pruned
    turn1_out = msgs[1]["parts"][0]["output"]
    assert "tweets" not in turn1_out
    assert turn1_out["status"] == "success"
    assert (
        turn1_out["summary"]
        == "Historical tool scrape payload collapsed to conserve context window."
    )

    # Turn 2 (older than latest 3 turns) should have grok_summary
    turn2_out = msgs[3]["parts"][0]["output"]
    assert "topics_scraped" not in turn2_out
    assert turn2_out["summary"] == "Summary of AI trends"

    # Turn 4 (within latest 3 turns) must remain INTACT
    turn4_out = msgs[7]["parts"][0]["output"]
    assert "tweets" in turn4_out
    assert len(turn4_out["tweets"]) == 20


def test_atomic_turn_grouping_never_orphans_tool_messages() -> None:
    """Issue #119: Sliding window never drops a ToolMessage without dropping its initiating AIMessage."""
    sys_msg = SystemMessage(content="You are a helpful assistant")

    # Turn Group 1:
    h1 = HumanMessage(content="User prompt 1 with enough text to consume tokens")
    ai1 = AIMessage(
        content="Thinking about calling tool 1",
        tool_calls=[{"id": "call_1", "name": "search_tool", "args": {"q": "test"}}],
    )
    t1 = ToolMessage(content="Tool search results 1 " * 20, tool_call_id="call_1")
    ai1_final = AIMessage(content="Final summary for turn 1")

    # Turn Group 2:
    h2 = HumanMessage(content="User prompt 2 with enough text to consume tokens")
    ai2 = AIMessage(
        content="Thinking about calling tool 2",
        tool_calls=[{"id": "call_2", "name": "search_tool", "args": {"q": "test2"}}],
    )
    t2 = ToolMessage(content="Tool search results 2 " * 20, tool_call_id="call_2")
    ai2_final = AIMessage(content="Final summary for turn 2")

    # Latest turn:
    latest_user = HumanMessage(content="Latest user prompt")

    all_msgs: list[BaseMessage] = [
        sys_msg,
        h1,
        ai1,
        t1,
        ai1_final,
        h2,
        ai2,
        t2,
        ai2_final,
        latest_user,
    ]

    # Calculate tokens of turn group 2 + sys + latest
    group2_tokens = estimate_total_tokens(
        messages=[sys_msg, h2, ai2, t2, ai2_final, latest_user]
    )
    # Budget that fits group 2, sys, and latest, but NOT group 1
    tight_budget = group2_tokens + 10

    budgeted = apply_sliding_window_budget(messages=all_msgs, token_budget=tight_budget)

    # Turn group 1 must be dropped entirely!
    assert h1 not in budgeted
    assert ai1 not in budgeted
    assert t1 not in budgeted
    assert ai1_final not in budgeted

    # Turn group 2 must be present in its entirety!
    assert h2 in budgeted
    assert ai2 in budgeted
    assert t2 in budgeted
    assert ai2_final in budgeted
    assert latest_user in budgeted
    assert sys_msg in budgeted

    # Verify atomic turn invariant: Any ToolMessage in result must have its initiating AIMessage immediately preceding
    for idx, msg in enumerate(budgeted):
        if isinstance(msg, ToolMessage):
            prev = budgeted[idx - 1]
            assert isinstance(prev, AIMessage), (
                f"ToolMessage at {idx} orphaned! Previous was {type(prev)}"
            )
            assert any(
                tc.get("id") == msg.tool_call_id
                for tc in getattr(prev, "tool_calls", [])
            ), "ToolMessage has no matching tool_call in preceding AIMessage"


def test_sliding_window_with_parallel_tool_calls_atomic_preservation() -> None:
    """Adversarial: Multi-tool parallel calls in a single turn group remain bound together atomically."""
    sys_msg = SystemMessage(content="System prompt")
    user_prompt = HumanMessage(content="Analyze market")
    ai_calls = AIMessage(
        content="Calling search and grok in parallel",
        tool_calls=[
            {"id": "c1", "name": "search", "args": {}},
            {"id": "c2", "name": "grok", "args": {}},
            {"id": "c3", "name": "trends", "args": {}},
        ],
    )
    t1 = ToolMessage(content="Search output " * 10, tool_call_id="c1")
    t2 = ToolMessage(content="Grok output " * 10, tool_call_id="c2")
    t3 = ToolMessage(content="Trends output " * 10, tool_call_id="c3")
    ai_final = AIMessage(content="Final synthesis")
    latest = HumanMessage(content="Next user prompt")

    msgs: list[BaseMessage] = [
        sys_msg,
        user_prompt,
        ai_calls,
        t1,
        t2,
        t3,
        ai_final,
        latest,
    ]

    # Full budget keeps all
    full = apply_sliding_window_budget(messages=msgs, token_budget=10000)
    assert len(full) == 8

    # Budget insufficient for the parallel tool call turn drops the whole group
    low = apply_sliding_window_budget(messages=msgs, token_budget=20)
    assert len(low) == 2
    assert low == [sys_msg, latest]


def test_prune_tool_call_outputs_resilient_to_malformed_outputs() -> None:
    """Adversarial: Pruning handles null parts, corrupt structures, and missing fields cleanly."""
    malformed_transcript = {
        "messages": [
            None,
            "not a dict",
            {"role": "assistant", "parts": None},
            {
                "role": "assistant",
                "parts": [
                    None,
                    {"type": "not_a_tool"},
                    {"type": "tool_call", "output": None},
                    {
                        "type": "tool_call",
                        "output": {"tweets": None, "status": "failed"},
                    },
                    {"type": "tool_call", "output": 12345},
                ],
            },
        ]
    }
    pruned = prune_tool_call_outputs(
        transcript=malformed_transcript, recent_turns_intact=0
    )
    assert pruned is not None
    clean_parts = pruned["messages"][1]["parts"]
    assert len(clean_parts) == 5
    assert clean_parts[3]["output"]["status"] == "failed"


def test_count_tokens_unicode_and_unknown_models() -> None:
    """Adversarial: count_tokens handles emojis, rare unicode, and unknown model identifiers."""
    complex_text = "🚀 Social Growth Strategy 💡 #LinkX 日本語 • 한국어 • 🌟"
    tokens = count_tokens(text=complex_text, model="custom-unknown-llm-v999")
    assert tokens > 0
    assert count_tokens(text="") == 0
    assert count_tokens(text=None) == 0  # type: ignore[arg-type]
