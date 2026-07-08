# LinkX Documentation

## Architecture & Vision

| Document | Status | Description |
|----------|--------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 📝 Draft | System overview, tech stack decisions, how components connect |
| [ROADMAP.md](./ROADMAP.md) | 📝 Draft | Phased implementation plan and milestones |

## Spec Files (discuss → spec → implement)

Work through these one at a time. Each spec starts as an outline, gets discussed and fleshed out, then drives implementation.

| # | Spec | Status | Description | Depends On |
|---|------|--------|-------------|------------|
| 1 | [browser-engine](./specs/browser-engine.md) | 🔲 Outline | Playwright automation core: lifecycle, stealth, contexts | — |
| 1b| [evasion-strategy](./specs/evasion-strategy.md) | ✅ Done | Strategy for evading TLS, Javascript, and behavioral bot detection | #1 |
| 2 | [platform-adapters](./specs/platform-adapters.md) | 🔲 Outline | Per-platform adapter interface (LinkedIn, X, Threads) | #1 |
| 3 | [session-management](./specs/session-management.md) | 🔲 Outline | Cookie persistence, health checks, re-auth flows | #1 |
| 4 | [scheduler](./specs/scheduler.md) | 🔲 Outline | Background job processing, retry, distributed lock | — |
| 5 | [ai-stack](./specs/ai-stack.md) | 🔲 Outline | LangGraph + LangChain + LiteLLM integration | — |
| 6 | [brand-voice](./specs/brand-voice.md) | 🔲 Outline | Tone/style configuration and prompt engineering per brand | #5 |
| 7 | [trending-topics](./specs/trending-topics.md) | 🔲 Outline | Scraping, filtering, ranking pipeline | #1, #2 |
| 8 | [content-curation](./specs/content-curation.md) | 🔲 Outline | Daily AI agent: trends → drafts → review inbox | #5, #6, #7 |
| 9 | [post-lifecycle](./specs/post-lifecycle.md) | 🔲 Outline | State machine, review/approve/schedule workflow | #4, #8 |
| 10 | [data-model](./specs/data-model.md) | 🔲 Outline | Schema evolution: new tables, Persona → Brand rename | — |

## Existing Specs (legacy reference)

These were written for the original API-based approach. Keep for reference but superseded by the new specs above.

| Document | Notes |
|----------|-------|
| [PERSONA_TEAM_SPEC.md](./specs/PERSONA_TEAM_SPEC.md) | Core persona/team model — still relevant, Brand rename pending |
| [SOCIAL_MEDIA_INTEGRATION.md](./specs/SOCIAL_MEDIA_INTEGRATION.md) | API-based approach — **superseded by browser-engine + platform-adapters** |
| [OAUTH_ARCHITECTURE_AND_PATTERNS.md](./specs/OAUTH_ARCHITECTURE_AND_PATTERNS.md) | REST API OAuth — **superseded by session-management** |
| [X_IMPLEMENTATION.md](./specs/X_IMPLEMENTATION.md) | X API integration — **superseded by platform-adapters** |
| [IMPLEMENTATION_ROADMAP.md](./specs/IMPLEMENTATION_ROADMAP.md) | Old roadmap — **superseded by ROADMAP.md** |

## Setup Guides

| Document | Description |
|----------|-------------|
| [SESSION_BOOTSTRAP.md](./SESSION_BOOTSTRAP.md) | **How sessions work** — macOS Keychain problem, mock keychain solution, step-by-step login guide |
| [LINKEDIN_SETUP.md](./LINKEDIN_SETUP.md) | LinkedIn app setup (legacy OAuth — will be replaced by browser auth) |
| [X_SETUP.md](./X_SETUP.md) | X/Twitter app setup (legacy API — will be replaced by browser auth) |
| [BRANDKIT.md](./BRANDKIT.md) | Brand assets and design tokens |
