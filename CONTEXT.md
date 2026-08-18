# CONTEXT

## Domain Glossary

### Browser Automation & Self-Healing
- **Playwright Toolbelt**: A collection of deterministic browser inspection and interaction primitives (`take_screenshot`, `get_dom_snapshot`, `test_selector`, `patch_config`) callable by agentic state machines.
- **Self-Healing Selector Engine**: A diagnostic supervisor that detects selector evaluation misses during scraping or publishing, inspects the live visual and structural DOM via multimodal vision models, verifies candidate selectors, and updates selector configuration files (`scrape_config.json`, `x_selectors.json`).
- **Selector Patch**: An atomic update to a selector definition mapping in configuration files, verified against the live DOM before persistence.

### Agentic Orchestration & Content Lifecycle
- **Agentic Content Pipeline**: A LangGraph-orchestrated graph executing sequential and conditional stages (`scrape` -> `query` -> `vision analyze` -> `draft`) to produce high-engagement drafts from live social signals.
- **HITL Gate (Human-in-the-Loop Gate)**: The strict safety boundary where autonomous agents are restricted to generating and persisting posts in `draft` status. The transition to `publishing` requires explicit human review and action.
- **Vision Extractor**: An AI service utilizing multimodal frontier models (`gemini-3-flash`) to parse rendered screenshots into typed Pydantic data structures without relying on brittle DOM traversal.
