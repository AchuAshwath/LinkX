# Research Report & Architecture Specification: Frontend Restructure (Issue #68)

**Document Path:** `docs/research/frontend_restructure_approach_routes.md`
**Status:** Completed Technical Specification
**Scope:** Full-stack frontend route reorganization, modern blog-style showcase feed, dedicated approach routes (`/approach/api`, `/approach/browser`, `/approach/vision`), dead route cleanup, and LinkX design system compliance.

---

## 1. Executive Summary & Architectural Motivation

LinkX demonstrates three fundamentally distinct technical paradigms for social media automation:
1. **API Direct (System C):** Official OAuth 2.0 REST API integration for LinkedIn (`w_member_social`), executing structured JSON REST requests.
2. **Stealth Browser (System A):** Anti-bot evasion engine for X.com utilizing `rebrowser-playwright` with CDP patch, headless/headed browser sessions, persistent cookie contexts, and automated trend scraping.
3. **Multimodal AI & Vision (System B):** OCR and vision-driven post generation from charts, diagrams, and infographics.

This restructuring accomplishes three core goals:
- **Transform `/home` into a Blog-Style Showcase Feed** with method filter pills (`All Posts`, `⚡ API Direct`, `🕵️ Stealth Browser`, `👁️ Multimodal AI & OCR`) and rich card presentation.
- **Introduce Dedicated Approach Routes (`/approach/*`)** providing interactive demo consoles for each technical pipeline.
- **Prune dead legacy routes (`/about.tsx`, `/canvas.tsx`)** and streamline sidebar/mobile navigation according to the LinkX design system.

---

## 2. TanStack Router Tree & Route Reorganization

```
frontend/src/routes/
├── __root.tsx                           # Root layout (react-query + router devtools)
├── _layout.tsx                          # Auth-guarded main app layout (Navbar + Sidebar + Main)
├── _layout/
│   ├── home.tsx                         # /home: Blog-Style Showcase Feed with method filter pills
│   ├── approach/
│   │   ├── api.tsx                      # /approach/api: LinkedIn OAuth & REST API demo console
│   │   ├── browser.tsx                  # /approach/browser: X Stealth browser engine & trend scraper
│   │   └── vision.tsx                   # /approach/vision: Chart/Infographic OCR & Multimodal AI generator
│   ├── posts.tsx                        # /posts: Complete post lifecycle table (Drafts, Scheduled, Posted, Failed)
│   ├── social-accounts.tsx              # /social-accounts: Connected Accounts (LinkedIn & X)
│   ├── accounts.tsx                     # /accounts: Redirects to /social-accounts (backward compatibility)
│   ├── ai.tsx                           # /ai: AI Assistant chat interface
│   └── settings.tsx                     # /settings: Profile & security settings
```

---

## 3. Step-by-Step Implementation Roadmap

1. **Phase 1: Route & File Structure Scaffolding**
   - Create `frontend/src/routes/_layout/approach/api.tsx`, `browser.tsx`, and `vision.tsx`.
   - Remove dead routes (`about.tsx`, `canvas.tsx`).
2. **Phase 2: Modern Blog Showcase Feed (`/home`)**
   - Create `ShowcaseFilterPills.tsx` and `ShowcasePostCard.tsx`.
   - Update `home.tsx` to integrate method filtering and rich card presentation.
3. **Phase 3: Dedicated Approach Route Consoles**
   - Implement `/approach/api` (LinkedIn OAuth token card + Live REST API composer + response inspector).
   - Implement `/approach/browser` (X session status + evasion badges + trend scraper console + simulation runner).
   - Implement `/approach/vision` (Chart dropzone + OCR preview + Multimodal AI post generator).
4. **Phase 4: Sidebar & Mobile Navigation Update**
   - Update `Sidebar.tsx` with the new Approach navigation group and pill styling.
5. **Phase 5: Verification & Quality Assurance**
   - Run frontend linter: `cd frontend && bun run lint`.
   - Run frontend build: `cd frontend && bun run build`.
