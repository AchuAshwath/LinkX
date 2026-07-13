# LinkX — Research Roadmap

> **Status:** Draft — to be finalized after all specs are discussed

## Phases

### Phase 0: System A — Core Automation Loop (MVP Focus)
> Build the direct automation pipeline to serve as the **control case** demonstrating what ToS clauses catch.

| Spec | Deliverable |
|------|-------------|
| [browser-engine](./specs/browser-engine.md) | Playwright lifecycle, rebrowser-playwright evasion, 3-tier self-healing |
| [session-management](./specs/session-management.md) | Persistent login, browser-use profile integration |
| [ai-stack](./specs/ai-stack.md) | 3 HTTP Pillars (Ollama, OpenCode Serve, LiteLLM) |
| [trending-topics](./specs/trending-topics.md) | browser-use agent to scrape X trending topics to JSON |

### Phase 1: System A — Posting Adapter
> Complete the browser-based posting pipeline. Document forensic artifacts and detection vectors for the thesis.

| Spec | Deliverable |
|------|-------------|
| [platform-adapters](./specs/platform-adapters.md) | X & LinkedIn posting scripts with self-healing fallback |

### Phase 2: System B — Observation Architecture (Research)
> Design and document the observation-based alternative. Prove the jurisdictional gap exists.

| Spec | Deliverable |
|------|-------------|
| [RESEARCH.md](./RESEARCH.md) | Full thesis document with comparative ToS analysis |
| observation-architecture (to be written) | System B design: capture → VLM → staging → human gate |
| forensic-comparison (to be written) | Side-by-side artifact analysis: System A vs B |

### Phase 3: Post-MVP Foundations (Future)
> Move scheduler, advanced database schema, and custom UI into focus only after the core loop is stable.

| Spec | Deliverable |
|------|-------------|
| [data-model](./specs/data-model.md) | Schema changes, BrandVoice tables, post logging |
| [scheduler](./specs/scheduler.md) | APScheduler worker, concurrency locks, retry queues |
| [post-lifecycle](./specs/post-lifecycle.md) | Review/approve inbox, calendar UI |

---

## Implementation Order

```
[browser-engine] ──→ [session-management] ──→ [ai-stack]
                                                   │
[platform-adapters] 🖲️ (Post agent) ←── [trending-topics] 🖲️ (Scrape agent)
                                                   │
                                    [observation-architecture] 📐 (System B design)
```

## Milestones

| Milestone | Definition of Done |
|-----------|---------------------|
| **M1: Headed Login & Sessions** | Run a script to log into LinkedIn/X, saving profiles to `sessions/` |
| **M2: Trend Scraping** | browser-use agent successfully extracts trending topics as structured JSON |
| **M3: Manual Post Trigger** | Post text successfully to LinkedIn/X using the persistent session |
| **M4: Complete Core Loop** | Single Python command: Scrape Trends ➔ Draft via AI ➔ Post to platforms |
| **M5: Research Documentation** | RESEARCH.md complete with comparative ToS analysis and forensic comparison |
| **M6: System B Spec** | Observation architecture spec written and reviewed |
