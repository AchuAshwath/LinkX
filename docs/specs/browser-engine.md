# Spec: Browser Automation Engine

> **Status:** 🔲 Outline — needs discussion
> **Depends on:** Nothing (foundation)
> **Depended on by:** [platform-adapters](./platform-adapters.md), [session-management](./session-management.md), [trending-topics](./trending-topics.md)

## Problem

Social media APIs are expensive (X: $100+/mo) or painful to set up (LinkedIn OAuth). We need a browser automation layer that can authenticate, post, and scrape as if a real user were doing it.

## Questions to Discuss

### Architecture
- [ ] Should Playwright run in-process with FastAPI or as a separate service/container?
- [ ] How many concurrent browser contexts do we need?
- [ ] Should we use a browser pool pattern (pre-warmed contexts) or spin up on demand?

### Stealth & Anti-Detection
- [ ] Which stealth techniques do we need? (playwright-stealth, fingerprint rotation, human-like delays)
- [ ] Do we need to rotate user agents or viewport sizes?
- [ ] Should we use headed mode for initial login (user watches) and headless for background tasks?

### Resource Management
- [ ] Memory budget per browser context?
- [ ] How to handle cleanup on crash/restart?
- [ ] Should browser contexts be shared across brands or isolated 1:1?

### Error Handling
- [ ] What happens when a page structure changes unexpectedly?
- [ ] How do we detect and report "platform blocked us"?
- [ ] Retry strategy for transient browser errors?

## Topics to Spec Out

1. BrowserEngine class lifecycle (init, shutdown, health)
2. Context management (create, reuse, destroy)
3. Stealth configuration
4. Error taxonomy (network, selector, auth, rate-limit)
5. Resource limits and monitoring
6. Docker/container considerations (Playwright deps, display server)
