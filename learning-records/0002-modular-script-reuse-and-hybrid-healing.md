# 0002 - Modular Script Reuse and Hybrid Self-Healing Architecture

Established that existing automation scripts (`scrape_trending_topics.py`, `x_posts.py`) will not be rewritten from scratch or wrapped in redundant layers. Instead, they will be decomposed directly into discrete, exported modular functions that can be imported seamlessly into LangGraph nodes.

## Key Architectural Principles Settled
1. **Single-Responsibility Modular Functions**:
   - `extract_trending_sidebar`, `extract_topic_tweets`, `enter_compose_text`, `attach_media_file`, `submit_and_verify_post` are exported as pure, testable async functions.
2. **Hybrid Trigger Loop**:
   - Non-blocking preflight probe + runtime timeout trap + post-action state verification.
3. **Dual Persistence**:
   - Disk JSON file hot-patching + in-memory cache update.
4. **DOM-First Diagnostic**:
   - Pruned semantic DOM snippet passed to `gemini-3.7-flash-high` with `SelectorDiagnosisReport` structured output.
