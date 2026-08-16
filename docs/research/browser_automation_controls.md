# Research & Technical Architecture: Browser Automation Engine Controls & Live Execution (Issue #69)

**Document Path:** `docs/research/browser_automation_controls.md`
**Status:** Completed Architecture Specification
**Scope:** Pillar 2 — Browser Automation Engine Controls in LinkX (Headless vs Headed Execution, Direct Post Creator, Trend Scraper Control Center, Evasion Management).

---

## 1. Executive Summary

This document presents the complete technical architecture and implementation roadmap for **Pillar 2: Browser Automation Engine Controls & Live Execution** in LinkX.

The Browser Automation Engine provides browser-driven social media capabilities (posting and trend scraping) operating directly on X.com and LinkedIn without costly API tiers. The `/approach/browser` workspace exposes granular operator controls, including:
1. **Direct Post Creator**: Immediate posting to X.com with character limits (280 max), non-linear humanized keyboard/mouse emulation (`EvasionMouse`), and live execution mode toggles (**Headless background** vs. **Headed live visual window**).
2. **Trend Scraper Control Center**: On-demand extraction of sidebar trends and Grok/news summaries from X.com with configurable topic limits, live execution progress feedback, and an **Auto-Curate & Post** bridge for instantaneous draft generation.
3. **Evasion & Session Management**: Tight integration with `rebrowser-playwright`, persistent Chromium user profiles under `sessions/{user_id}/x`, pre-action sentinel validation, and automated WAF/CAPTCHA/rate-limit detection.

---

## 2. System Architecture & High-Level Design

```
                     ┌─────────────────────────────────────────────────────────┐
                     │           Frontend Workspace: /approach/browser         │
                     │  ┌─────────────────────────┐ ┌───────────────────────┐  │
                     │  │   Direct Post Creator   │ │ Trend Scraper Center  │  │
                     │  │ - 280 char counter      │ │ - Max topics slider   │  │
                     │  │ - Headless / Headed UI  │ │ - Live progress feed  │  │
                     │  │ - Evasion status badge  │ │ - Auto-Curate bridge  │  │
                     │  └───────────┬─────────────┘ └───────────┬───────────┘  │
                     └──────────────┼───────────────────────────┼──────────────┘
                                    │ TanStack Query (SDK)      │ SSE / JSON
                                    ▼                           ▼
                     ┌─────────────────────────────────────────────────────────┐
                     │                   FastAPI Backend API                   │
                     │  POST /api/v1/browser/post   POST /api/v1/browser/scrape│
                     │  GET  /api/v1/browser/session/status                    │
                     └──────────────┬───────────────────────────┬──────────────┘
                                    │                           │
                                    ▼                           ▼
                     ┌────────────────────────────┐ ┌──────────────────────────┐
                     │   XPostClient (Posting)    │ │ scrape_trending_topics   │
                     │ - Char count validation    │ │ - Sidebar heuristic scan │
                     │ - Sentinel home check      │ │ - Grok summary parser    │
                     │ - GraphQL response capture │ │ - Top tweets extraction  │
                     └──────────────┬─────────────┘ └───────────┬──────────────┘
```

---

## 3. Implementation Milestones

| Phase | Milestone | Tasks |
|---|---|---|
| **Phase 1** | **Backend Core & Router** | Create `backend/app/api/routes/browser.py` with `post` and `scrape-trends` endpoints; update `XPostClient` to accept `headless: bool` parameter. |
| **Phase 2** | **OpenAPI Client Generation** | Run `bash ./scripts/generate-client.sh` to produce typed TypeScript SDK client (`BrowserService`). |
| **Phase 3** | **Frontend Workspace UI** | Build route `frontend/src/routes/_layout/approach/browser.tsx` with `DirectPostCreator` (280-char gauge and Headless/Headed switch) and `TrendScraperControlCenter`. |
| **Phase 4** | **Sidebar Navigation & Routing** | Add `Browser Controls` link under Approach in `Sidebar.tsx`. |
| **Phase 5** | **Testing & Validation** | Unit & Integration tests in `backend/tests/api/routes/test_browser.py`. |
