# Mission: LangChain & LangGraph Architecture for LinkX Agentic Orchestration

## Why
Master LangChain and LangGraph to architect LinkX's content curation and browser automation as modular, reusable, and self-healing agentic workflows rather than isolated one-off scripts.

## Success looks like
- Understand the core mental model: StateGraph, Nodes, Edges, State (Pydantic/TypedDict), and Checkpoints.
- Understand how requests and inputs enter a LangGraph workflow (rich Typed State objects vs raw text).
- Know how to convert deterministic Playwright scripts into clean, reusable `@tool` functions that agents can reason over and execute.
- Know how to design self-healing recovery loops (attempt -> fail -> capture diagnostic -> fix config -> retry).
- Confidently make architectural decisions for Issue #86 and #87 in LinkX.

## Constraints
- Focused strictly on LinkX's Python backend (`langchain-core`, `langchain-openai`, `langgraph`, `rebrowser-playwright`, CLIProxyAPI).
- Interactive, step-by-step learning before jumping into large code changes.

## Out of scope
- Theoretical agent frameworks not supported by LangGraph (AutoGPT, CrewAI).
- LangSmith deployment / cloud enterprise setups (local LangGraph runtime is used).
