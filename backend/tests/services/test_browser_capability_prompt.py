from langchain_core.messages import SystemMessage

from app.services.ai_chat_runner import _build_message_history


def test_chat_system_prompt_explains_native_browser_tab_sharing() -> None:
    messages = _build_message_history(
        transcript=None,
        current_message="I will share you a browser tab, tell me what people posted.",
    )

    assert isinstance(messages[0], SystemMessage)
    prompt = str(messages[0].content).lower()
    assert "browser tab" in prompt
    assert 'choosing "browser tab" from the + menu beside the prompt' in prompt
    assert "transcribed asynchronously into temporary chat-owned memory" in prompt
    assert "claim current sharing only from supplied session evidence" in prompt
    assert "describe content only from supplied notes or images" in prompt
    assert (
        "pending-frame metadata is processing state, not readable page content"
        in prompt
    )
    assert "or demand pasted content or screenshots as the only way" in prompt
    assert "no permission to control the tab" in prompt
    assert "processing is pending only when supplied state confirms it" in prompt
    assert (
        "reading or summarizing shared posts is not a request to create, edit, save or publish a draft"
        in prompt
    )
