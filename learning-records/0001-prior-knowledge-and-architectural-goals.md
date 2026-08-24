# 0001 - Prior Knowledge and Architectural Goals for LinkX Agentic Orchestration

The user wants to understand LangChain and LangGraph in depth to ensure that LinkX's browser automation scripts and scraping workflows are converted into reusable, modular tools rather than hardcoded script runs.

## Key Questions Raised
1. **Input Format**: Does LangGraph orchestration only take text as input, or can it receive rich structured state (e.g. topic objects, user IDs, image screenshots, action directives)?
2. **Modular Tool Abstraction**: How do Playwright scripts (like `scrape_trending_topics.py` and `x_posts.py`) get transformed into modular `@tool` primitives with instruction sets that the agent can reason about and call dynamically?
3. **Workflow Integration**: How does the frontend interaction (e.g. clicking "Draft" near a scraped topic) trigger the LangGraph orchestration with the right context?
4. **Self-Healing Mechanics**: How do graph cycles and conditional edges manage the attempt -> fail -> diagnose -> patch -> retry flow?
