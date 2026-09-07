from unittest.mock import patch

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
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
    assert count_tokens("") == 0
    token_count = count_tokens("Hello world, this is a test prompt for LinkX.")
    assert token_count > 0

    with patch("tiktoken.encoding_for_model", side_effect=Exception("Encoding error")):
        with patch("tiktoken.get_encoding", side_effect=Exception("No encoding")):
            fallback_count = count_tokens("Short sentence for test.")
            assert fallback_count == len("Short sentence for test.") // 4


def test_estimate_message_tokens_multimodal() -> None:
    """Issue #119: Verify estimation for text and multimodal content."""
    text_msg = HumanMessage(content="Simple user query")
    tokens = estimate_message_tokens(text_msg)
    assert tokens >= 4

    multi_msg = HumanMessage(
        content=[
            {"type": "text", "text": "Check this screenshot"},
            {"type": "image_url", "image_url": {"url": "https://example.com/img.png"}},
        ]
    )
    multi_tokens = estimate_message_tokens(multi_msg)
    # Should include 300 overhead for the image_url plus text tokens
    assert multi_tokens >= 304


def test_estimate_total_tokens() -> None:
    """Issue #119: Verify total token summation across multiple messages."""
    msgs: list[BaseMessage] = [
        SystemMessage(content=LINKX_SYSTEM_PROMPT),
        HumanMessage(content="First message"),
        AIMessage(content="First response"),
    ]
    total = estimate_total_tokens(msgs)
    individual_sum = sum(estimate_message_tokens(m) for m in msgs)
    assert total == individual_sum
    assert total > 0


def test_prune_tool_call_outputs_truncates_large_payloads() -> None:
    """Issue #119: Verify pruning large tool outputs exceeding max_chars."""
    assert prune_tool_call_outputs(None) is None

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
    pruned = prune_tool_call_outputs(transcript, max_chars=300)
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
    unbounded = apply_sliding_window_budget(all_msgs, token_budget=10000)
    assert len(unbounded) == 11

    # Extremely constrained budget keeps system message and latest message
    constrained = apply_sliding_window_budget(all_msgs, token_budget=20)
    assert len(constrained) == 2
    assert constrained[0] == sys_msg
    assert constrained[-1] == turns[-1]
