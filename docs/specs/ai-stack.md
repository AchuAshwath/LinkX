# Spec: AI Stack

> **Status:** 📝 Draft — under review
> **Depends on:** Nothing (foundation)
> **Depended on by:** [brand-voice](./brand-voice.md), [content-curation](./content-curation.md)

## Problem

LinkX needs AI to write posts, generate ideas from trending topics, and self-heal broken
browser selectors. We want to avoid forcing developers to get a new API key and pay for tokens
separately — they should be able to reuse existing subscriptions or local hardware.

---

## Core Architecture: The 3 HTTP Pillars

We do **not** use brittle CLI subprocess wrappers. LinkX communicates exclusively via standard HTTP APIs (primarily the OpenAI-compatible specification). This keeps the orchestration layer (LangGraph/LangChain) robust and native.

We support three distinct provider paths based on the user's preference and available hardware:

### 1. Ollama (The True Offline Path)
**How it works:** Ollama runs a local OpenAI-compatible HTTP server at `http://localhost:11434`.
Uses `langchain-ollama` for native integration. Fully offline, free, no subscription, no key.

**When to use:** Self-hosted deployments on hardware with sufficient RAM/GPU.
*   **Raspberry Pi 5:** `gemma3:4b` (~3GB RAM)
*   **Mac Mini / Laptop:** `llama3.1:8b` (~6GB RAM)

### 2. OpenCode Serve (The "Bring Your Own Subscription" Path)
**How it works:** Tools like OpenCode have a local headless server mode (`opencode serve`).
This exposes a local REST API (default `http://localhost:4096`).
LinkX sends standard JSON payloads to this endpoint.

**When to use:** The developer already pays for Claude Pro or Google One AI Premium. They configure OpenCode to use their Gemini/Claude account, launch `opencode serve`, and LinkX routes tasks through it for **zero additional API cost**. (Note: OpenCode supports plugins/providers for Gemini, Anthropic, etc.)

### 3. LiteLLM (The Direct API Path)
**How it works:** LiteLLM is a translation layer that abstracts over 100+ LLM providers into the standard OpenAI API format.
User sets `AI_MODEL` and `AI_API_KEY` in `.env`.

**When to use:** When the user wants to use a direct API.
*   **Gemini Free Tier:** `AI_MODEL=gemini/gemini-2.0-flash`. Google AI Studio provides 1,500 requests/day completely for free.
*   **OpenRouter Free Tier:** `AI_MODEL=openrouter/google/gemma-3-12b-it:free`.
*   **Paid APIs:** `AI_MODEL=anthropic/claude-3-5-sonnet` (for users who want to pay standard API rates).

---

## Unified Client Interface

All LangGraph nodes in the backend interact with a single `AIClient` interface. The client abstracts whether the underlying provider is Ollama, OpenCode, or LiteLLM.

```python
# backend/app/services/ai/client.py
from litellm import completion

class AIClient:
    def __init__(self, provider: str = "litellm", base_url: str = None):
        self.provider = provider
        self.base_url = base_url

    async def complete_structured(self, prompt: str, schema: type) -> dict:
        """Ask for JSON output and validate against a Pydantic schema."""

        # If using OpenCode Serve
        if self.provider == "opencode":
            # Send HTTP request to self.base_url (e.g. localhost:4096)
            return await self._call_opencode(prompt, schema)

        # If using LiteLLM (handles Gemini API, Anthropic, OpenAI, etc)
        # or Ollama (if configured via LiteLLM custom base_url)
        response = completion(
            model="your_configured_model",
            messages=[{"role": "user", "content": prompt}],
            # LiteLLM handles translating this structured output request to the specific provider
            response_format=schema.model_json_schema()
        )
        raw_json = response.choices[0].message.content
        return schema.model_validate_json(raw_json)
```

## AI Task Tiers

Not all AI tasks need the same model quality. We use two tiers:

| Task | Tier | Recommended Model | Tokens used |
|---|---|---|---|
| **Selector healing** | Fast / cheap | `gemma3:4b` / `gemini-2.0-flash` | ~2K per heal event |
| **Trend summarization** | Fast / cheap | `gemma3:4b` / `gemini-2.0-flash` | ~1K per topic |
| **Post drafting** | Quality | `llama3.1:8b` / `claude-3-5-sonnet` | ~3K per draft |
| **Brand voice analysis** | Quality | `llama3.1:8b` / `claude-3-5-sonnet` | ~2K one-time setup |

Users can override the default models in `.env`:
`AI_MODEL_CHEAP=gemini/gemini-2.0-flash`
`AI_MODEL_QUALITY=anthropic/claude-3-5-sonnet`
