# Spec: Platform Adapters

> **Status:** 🔲 Outline — needs discussion
> **Depends on:** [browser-engine](./browser-engine.md)
> **Depended on by:** [trending-topics](./trending-topics.md), [post-lifecycle](./post-lifecycle.md)

## Problem

Each social platform has a different web UI, login flow, posting mechanism, and feed structure. We need a common adapter interface so the rest of the system doesn't care which platform it's talking to.

## Questions to Discuss

### Interface Design
- [ ] What's the minimal adapter interface for v1? (login, post_text, get_trending, health_check?)
- [ ] Should adapters be async generators (streaming results) or simple async functions?
- [ ] How do we version adapters when platform UIs change?

### Platform-Specific Concerns
- [ ] **LinkedIn:** How does the compose UI work? Are there hidden API calls we can intercept instead of DOM manipulation?
- [ ] **X/Twitter:** How does login work? Do they have aggressive bot detection?
- [ ] **Threads:** Worth including in v1 or defer?
- [ ] **Bluesky:** Has an open API — should this one use the API instead of browser?

### Selector Management
- [ ] How do we maintain CSS/XPath selectors when platforms redesign?
- [ ] Should selectors be in external JSON config files (updateable without code changes)?
- [ ] Community-maintained selector registry?

### Content Formatting
- [ ] How do we handle character limits per platform?
- [ ] Hashtag conventions differ (LinkedIn vs X) — who handles the transformation?
- [ ] Image/media upload via browser — how complex is this per platform?

## Topics to Spec Out

1. `PlatformAdapter` protocol/interface definition
2. LinkedIn adapter: login flow, compose flow, selectors
3. X adapter: login flow, compose flow, selectors
4. Selector versioning and update strategy
5. Content transformation per platform
6. Error codes and retryable vs fatal failures
