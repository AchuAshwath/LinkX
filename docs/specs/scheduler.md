# Spec: Scheduler Service

> **Status:** 🔲 Outline — needs discussion
> **Depends on:** Nothing (foundation)
> **Depended on by:** [post-lifecycle](./post-lifecycle.md), [content-curation](./content-curation.md)

## Problem

Posts need to be published at scheduled times. The AI agent needs to run on a daily cron. Trending topics need periodic scraping. We need a reliable background job system that handles retries, failures, and concurrent workers.

## Context

The existing codebase has post model fields for scheduling (`scheduled_at`, `retry_count`, `next_retry_at`, etc.) and a post state machine (`draft → scheduled → publishing → published → failed`), but **no scheduler service implementation exists yet**.

See: [IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md) § Scheduler Service (the original spec — still relevant for retry/error classification logic).

## Questions to Discuss

### Job Types
- [ ] What jobs need scheduling? (post publishing, trend scraping, session health checks, AI curation, engagement tracking)
- [ ] Which are cron-based (recurring) vs one-shot (publish at specific time)?
- [ ] Priority ordering — if multiple posts are due, which goes first?

### Architecture
- [ ] APScheduler in-process vs Celery vs ARQ vs custom polling loop?
- [ ] Single worker or multi-worker? (affects locking strategy)
- [ ] How does the scheduler interact with the browser engine? (direct call vs message queue)

### Reliability
- [ ] Retry strategy: exponential backoff, max retries, dead letter queue?
- [ ] What happens if the server crashes mid-publish? (idempotency)
- [ ] Distributed lock strategy for multi-instance deployments?
- [ ] How do we prevent duplicate posts? (check `external_post_id` before publishing)

### Monitoring
- [ ] How does the admin see scheduler health? (existing `/admin/scheduler/status` endpoint)
- [ ] Alerting on failures — in-app notification, email, webhook?
- [ ] Job history/audit log?

## Topics to Spec Out

1. Job types and their schedules
2. SchedulerService class design
3. Locking strategy (Redis SETNX)
4. Retry policy and error classification (retryable vs fatal)
5. Idempotency guarantees
6. Integration with existing post state machine
7. Monitoring and admin endpoints
