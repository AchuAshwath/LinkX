# Spec: AI Stack (LangGraph + LangChain + LiteLLM)

> **Status:** 🔲 Outline — needs discussion
> **Depends on:** Nothing (foundation)
> **Depended on by:** [brand-voice](./brand-voice.md), [content-curation](./content-curation.md)

## Problem

We need to build a sophisticated AI agent that can reason about trending topics, draft posts matching a specific brand voice, and interact with the user for review/approval. We want to avoid provider lock-in and allow users to bring their own API keys (or run local models).

## Context

We have decided on the following stack:
1. **LiteLLM**: Provider abstraction. One interface for OpenAI, Anthropic, Gemini, Ollama, etc.
2. **LangChain**: Prompt templates, chains, output parsers, and tool calling wrappers.
3. **LangGraph**: Stateful agent workflows, modeling the curation pipeline as a graph with "human-in-the-loop" pauses for review.

## Questions to Discuss

### LLM Configuration
- [ ] How does the user configure their preferred model and API key? (Environment variables vs database settings)
- [ ] Should we support configuring different models for different tasks? (e.g., fast cheap model for topic filtering, smart expensive model for drafting)
- [ ] How do we handle API errors, rate limits, and failovers? (LiteLLM has built-in features for this)

### LangGraph Workflows
- [ ] What is the exact state object passed between nodes in the curation graph?
- [ ] Where does the graph execution pause for human intervention? (e.g., `interrupt_before=["publish"]`)
- [ ] How is the graph state persisted? (LangGraph supports PostgreSQL/Redis checkpointers — which should we use?)

### Tools and Capabilities
- [ ] What tools does the agent need access to? (e.g., `search_web`, `read_trending_topics`, `get_brand_guidelines`)
- [ ] Should the agent be able to trigger browser actions directly, or just output structured data for the scheduler?

## Topics to Spec Out

1. LiteLLM configuration and initialization (the `langchain-litellm` bridge)
2. Global AI settings (user config)
3. LangGraph state schema for the curation workflow
4. Checkpointer integration (saving agent state to DB)
5. Agent tools definition
