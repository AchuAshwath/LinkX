# LinkX — Roadmap

> **Status:** Draft — to be finalized after all specs are discussed

## Phases

### Phase 0: Foundation
> Build the core infrastructure that everything else depends on.

| Spec | Deliverable |
|------|-------------|
| [browser-engine](./specs/browser-engine.md) | Playwright lifecycle, stealth, browser contexts |
| [session-management](./specs/session-management.md) | Persistent login, cookie storage, health checks |
| [scheduler](./specs/scheduler.md) | APScheduler worker, retry logic, Redis lock |
| [data-model](./specs/data-model.md) | Schema changes for new features |

### Phase 1: Platform Connectivity
> Connect to social platforms via browser automation.

| Spec | Deliverable |
|------|-------------|
| [platform-adapters](./specs/platform-adapters.md) | LinkedIn + X adapters (login, post, scrape) |
| [trending-topics](./specs/trending-topics.md) | Scrape and surface trending topics |

### Phase 2: AI Agent
> The AI brain that curates content.

| Spec | Deliverable |
|------|-------------|
| [ai-stack](./specs/ai-stack.md) | LangGraph + LangChain + LiteLLM wiring |
| [brand-voice](./specs/brand-voice.md) | Brand tone configuration, prompt engineering |
| [content-curation](./specs/content-curation.md) | Daily agent: trends → drafts pipeline |

### Phase 3: Workflow & Polish
> The user-facing workflow that ties it all together.

| Spec | Deliverable |
|------|-------------|
| [post-lifecycle](./specs/post-lifecycle.md) | Review/approve/schedule flow, calendar UI |

---

## Implementation Order

> To be determined after specs are discussed. The rough idea:

```
[data-model] ──→ [browser-engine] ──→ [session-management] ──→ [platform-adapters]
                                                                       │
[scheduler] ────────────────────────────────────────────→ [post-lifecycle]
                                                                       │
[ai-stack] ──→ [brand-voice] ──→ [trending-topics] ──→ [content-curation]
```

## Milestones

| Milestone | Definition of Done |
|-----------|--------------------|
| **M1: "I can post from the browser"** | Login via Playwright, post text to LinkedIn |
| **M2: "Posts happen on schedule"** | Scheduler picks up queued posts and publishes them |
| **M3: "AI writes my posts"** | LangGraph agent drafts posts from trending topics |
| **M4: "Full loop"** | Trends → AI drafts → Review inbox → Approve → Auto-publish |
