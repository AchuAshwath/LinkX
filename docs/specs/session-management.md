# Spec: Session Management

> **Status:** 🔲 Outline — needs discussion
> **Depends on:** [browser-engine](./browser-engine.md)
> **Depended on by:** [platform-adapters](./platform-adapters.md)

## Problem

Browser-based auth means we're dealing with cookies, local storage, and session tokens instead of OAuth access tokens. These sessions need to persist across server restarts, be health-checked regularly, and re-authenticate automatically when expired.

## Questions to Discuss

### Storage
- [ ] Where do we store session data? (encrypted files on disk, Postgres, Redis)
- [ ] What exactly needs to be persisted? (cookies, localStorage, sessionStorage, IndexedDB?)
- [ ] Playwright has `storageState` — is that sufficient or do we need more?
- [ ] Encryption strategy for session data at rest?

### Session Lifecycle
- [ ] How do we detect a session has expired? (failed page load, redirect to login, specific element check)
- [ ] Auto re-auth: should the system attempt to re-login automatically or notify the user?
- [ ] How to handle "remember me" vs short-lived sessions per platform?
- [ ] Should initial login be interactive (user types password in a visible browser window)?

### Health Checks
- [ ] How often should we verify sessions are still valid?
- [ ] What constitutes a "healthy" session per platform?
- [ ] Should health checks run on a schedule or on-demand before each operation?

### Multi-Account
- [ ] Each Brand gets its own browser context + session — correct?
- [ ] Can a Brand be connected to multiple platforms simultaneously?
- [ ] How do we prevent session cross-contamination?

## Topics to Spec Out

1. Session data model (what gets stored, where, encrypted how)
2. `SessionManager` class interface
3. Login flow (interactive first-time, automated re-auth)
4. Health check strategy per platform
5. Session migration from current Redis-based OAuth tokens
6. Credential storage (user's platform passwords — how/where/encrypted)
