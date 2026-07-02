# Spec: Data Model Evolution

> **Status:** 🔲 Outline — needs discussion
> **Depends on:** All other specs
> **Depended on by:** None

## Problem

The database schema needs to evolve to support the new features (browser sessions, brand voice config, trending topics) while maintaining backward compatibility where possible.

## Context

Current core tables: `User`, `Persona`, `Post`, `SocialAccount`, `Team`, `PersonaAccess`.

## Questions to Discuss

### Rename: Persona → Brand
- [ ] Do we rename the `persona` table to `brand` in Postgres via Alembic, or just rename it in the UI and keep the backend as `persona` for now to minimize migration churn?

### New Tables / Fields Required
- [ ] `BrowserSession` table (or store on `SocialAccount`?) to track persistent Playwright contexts.
- [ ] `TrendingTopic` table to cache scraped trends.
- [ ] Voice configuration fields on the `Persona` table (e.g., `voice_prompt`, `forbidden_topics`).
- [ ] AI metadata on `Post` (e.g., `is_ai_generated`, `original_trend_id`).

## Topics to Spec Out

1. Full schema diff for Alembic migration
2. Data migration plan for existing `Persona` rows (if any voice config needs defaults)
3. Cleanup of legacy `owner_id` fields (as specified in original specs)
